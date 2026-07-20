import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const PROVIDER = (process.env.AI_PROVIDER || "demo").toLowerCase();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        provider: configuredProvider()
      });
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const body = await readJson(req);
      const result = await generateTestSuite(body);
      return sendJson(res, 200, result);
    }

    if (req.method !== "GET") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    const status = error instanceof ClientError ? error.status : 500;

    if (status === 500) console.error(error);

    sendJson(res, status, {
      error: "Something went wrong while generating test cases.",
      details: error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`AI Test Case Generator running at http://localhost:${PORT}`);
  console.log(`AI provider: ${configuredProvider()}`);
});

function loadEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
    }
  }
}

function configuredProvider() {
  if (PROVIDER === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (PROVIDER === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  return "demo";
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new ClientError("Request body is too large.", 413);
  }

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new ClientError("Request body must contain valid JSON.");
  }
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = resolve(publicDir, `.${safePath}`);

  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  try {
    const file = await readFile(filePath);
    const type = mimeTypes[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function generateTestSuite(input) {
  const requirement = String(input.requirement || "").trim();
  const options = normalizeOptions(input.options);

  if (requirement.length < 20) {
    throw new ClientError("Please enter a user story or requirement with at least 20 characters.");
  }

  const provider = configuredProvider();
  if (provider === "openai") return generateWithOpenAI(requirement, options);
  if (provider === "gemini") return generateWithGemini(requirement, options);
  return generateDemoSuite(requirement, options);
}

function normalizeOptions(options = {}) {
  return {
    includeGherkin: Boolean(options.includeGherkin ?? true),
    includeEdgeCases: Boolean(options.includeEdgeCases ?? true),
    includeNegative: Boolean(options.includeNegative ?? true),
    domain: String(options.domain || "General web application"),
    riskLevel: String(options.riskLevel || "Medium")
  };
}

async function generateWithOpenAI(requirement, options) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: userPrompt(requirement, options) }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI request failed.");
  }

  return withMetadata(JSON.parse(data.choices[0].message.content), "openai", model);
}

async function generateWithGemini(requirement, options) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      },
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemPrompt()}\n\n${userPrompt(requirement, options)}` }]
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Gemini request failed.");
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return withMetadata(JSON.parse(text), "gemini", model);
}

function systemPrompt() {
  return `You are a senior QA engineer. Generate precise, interview-quality test coverage from requirements.
Return only valid JSON matching this schema:
{
  "summary": "short summary",
  "assumptions": ["assumption"],
  "testCases": [
    {
      "id": "TC-001",
      "title": "short title",
      "type": "Functional | Edge | Negative | Accessibility | Security | Performance",
      "priority": "High | Medium | Low",
      "preconditions": ["precondition"],
      "steps": ["step"],
      "expectedResult": "expected result"
    }
  ],
  "gherkin": ["Feature: ..."],
  "risks": ["risk"]
}`;
}

function userPrompt(requirement, options) {
  return `Requirement:
${requirement}

Context:
- Domain: ${options.domain}
- Risk level: ${options.riskLevel}
- Include edge cases: ${options.includeEdgeCases}
- Include negative scenarios: ${options.includeNegative}
- Include BDD Gherkin: ${options.includeGherkin}

Create 8 to 14 test cases. Cover happy path, validation, data, permissions, error handling, and integration behavior where relevant.`;
}

function withMetadata(suite, provider, model) {
  return {
    ...suite,
    metadata: {
      provider,
      model,
      generatedAt: new Date().toISOString()
    }
  };
}

function generateDemoSuite(requirement, options) {
  const title = inferTitle(requirement);
  const cases = [
    testCase("TC-001", `Create ${title} successfully`, "Functional", "High", [
      "User is authenticated",
      "Required data is available"
    ], [
      "Open the target workflow",
      "Enter valid required details",
      "Submit the form or action",
      "Review the confirmation state"
    ], "The system completes the workflow and shows a clear success confirmation."),
    testCase("TC-002", `Validate mandatory fields for ${title}`, "Negative", "High", [
      "User is on the target workflow"
    ], [
      "Leave required fields empty",
      "Submit the form or action"
    ], "The system blocks submission and displays field-level validation messages."),
    testCase("TC-003", `Reject invalid data for ${title}`, "Negative", "High", [
      "User is on the target workflow"
    ], [
      "Enter incorrectly formatted values",
      "Submit the form or action"
    ], "The system explains the invalid inputs and preserves user-entered data."),
    testCase("TC-004", `Handle duplicate submission for ${title}`, "Edge", "Medium", [
      "A matching record or request already exists"
    ], [
      "Enter details that duplicate an existing item",
      "Submit the workflow"
    ], "The system prevents unintended duplication or asks the user to confirm the intended action."),
    testCase("TC-005", `Permission check for ${title}`, "Security", "High", [
      "User account has restricted permissions"
    ], [
      "Attempt to access or submit the workflow"
    ], "The system denies unauthorized actions without exposing restricted data."),
    testCase("TC-006", `Recover from service failure during ${title}`, "Negative", "Medium", [
      "Downstream service is unavailable or times out"
    ], [
      "Submit valid data",
      "Trigger or simulate service failure"
    ], "The system shows a helpful error, logs the failure, and avoids partial inconsistent updates."),
    testCase("TC-007", `Boundary values for ${title}`, "Edge", "Medium", [
      "User is on the target workflow"
    ], [
      "Enter minimum allowed values",
      "Submit and verify behavior",
      "Repeat with maximum allowed values"
    ], "The system accepts valid boundaries and rejects values outside the allowed range."),
    testCase("TC-008", `Accessible usage of ${title}`, "Accessibility", "Medium", [
      "User can navigate with keyboard or assistive technology"
    ], [
      "Navigate the workflow using keyboard only",
      "Verify labels, focus order, and error announcements"
    ], "The workflow is usable without a mouse and communicates state changes accessibly.")
  ];

  const filtered = cases.filter((item) => {
    if (!options.includeEdgeCases && item.type === "Edge") return false;
    if (!options.includeNegative && item.type === "Negative") return false;
    return true;
  });

  return withMetadata({
    summary: `Demo test suite for: ${title}. Add an API key in .env for AI-generated coverage tailored to the full requirement.`,
    assumptions: [
      "The requirement represents a user-facing workflow.",
      "Authentication, authorization, validation, and audit behavior may apply depending on the product context."
    ],
    testCases: filtered,
    gherkin: options.includeGherkin ? buildDemoGherkin(title) : [],
    risks: [
      "Ambiguous acceptance criteria can cause missed scenarios.",
      "External integrations need contract and failure-mode testing.",
      "Role permissions should be verified with real user profiles."
    ]
  }, "demo", "local-template");
}

function testCase(id, title, type, priority, preconditions, steps, expectedResult) {
  return { id, title, type, priority, preconditions, steps, expectedResult };
}

function inferTitle(requirement) {
  const firstLine = requirement.split(/\r?\n/).find(Boolean) || "the requested capability";
  const storyGoal = firstLine.match(/\bi want to\s+(.+?)(?:\s+so that\b|$)/i)?.[1];
  const candidate = storyGoal || firstLine;

  return candidate
    .replace(/^as an?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function buildDemoGherkin(title) {
  return [
    `Feature: ${title}

  Scenario: Successful completion
    Given an authenticated user can access the workflow
    When the user submits valid required information
    Then the system completes the request
    And the user sees a success confirmation`,
    `Feature: ${title}

  Scenario: Required field validation
    Given a user is on the workflow
    When the user submits without required information
    Then the system prevents submission
    And field-level validation messages are displayed`
  ];
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ClientError";
    this.status = status;
  }
}

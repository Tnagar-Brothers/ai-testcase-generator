const requirementEl = document.querySelector("#requirement");
const domainEl = document.querySelector("#domain");
const riskLevelEl = document.querySelector("#riskLevel");
const includeGherkinEl = document.querySelector("#includeGherkin");
const includeEdgeCasesEl = document.querySelector("#includeEdgeCases");
const includeNegativeEl = document.querySelector("#includeNegative");
const generateButton = document.querySelector("#generateButton");
const sampleButton = document.querySelector("#sampleButton");
const messageEl = document.querySelector("#message");
const summaryEl = document.querySelector("#summary");
const outputEl = document.querySelector("#output");
const providerStatusEl = document.querySelector("#providerStatus");
const copyJsonButton = document.querySelector("#copyJsonButton");
const downloadCsvButton = document.querySelector("#downloadCsvButton");
const downloadFeatureButton = document.querySelector("#downloadFeatureButton");
const tabs = [...document.querySelectorAll(".tab")];

let currentSuite = null;
let currentTab = "cases";

const sampleStory = `As a registered customer,
I want to reset my password using my email address,
So that I can regain access to my account if I forget my password.

Acceptance Criteria:
- User can request a password reset link by entering a registered email.
- System does not reveal whether an email exists.
- Reset link expires after 30 minutes.
- User must enter and confirm a new password that meets password rules.
- User sees a success confirmation after resetting the password.`;

checkHealth();
renderEmpty();

sampleButton.addEventListener("click", () => {
  requirementEl.value = sampleStory;
  requirementEl.focus();
});

generateButton.addEventListener("click", generate);

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    currentTab = tab.dataset.tab;
    tabs.forEach((item) => item.classList.toggle("active", item === tab));
    renderSuite();
  });
});

copyJsonButton.addEventListener("click", async () => {
  if (!currentSuite) return setMessage("Generate test cases first.");
  await navigator.clipboard.writeText(JSON.stringify(currentSuite, null, 2));
  setMessage("JSON copied.");
});

downloadCsvButton.addEventListener("click", () => {
  if (!currentSuite) return setMessage("Generate test cases first.");
  download("test-cases.csv", toCsv(currentSuite.testCases), "text/csv");
});

downloadFeatureButton.addEventListener("click", () => {
  if (!currentSuite) return setMessage("Generate test cases first.");
  download("test-cases.feature", (currentSuite.gherkin || []).join("\n\n"), "text/plain");
});

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    providerStatusEl.textContent = `${data.provider.toUpperCase()} mode`;
  } catch {
    providerStatusEl.textContent = "Offline";
  }
}

async function generate() {
  setMessage("");
  generateButton.disabled = true;
  generateButton.textContent = "Generating...";

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requirement: requirementEl.value,
        options: {
          domain: domainEl.value,
          riskLevel: riskLevelEl.value,
          includeGherkin: includeGherkinEl.checked,
          includeEdgeCases: includeEdgeCasesEl.checked,
          includeNegative: includeNegativeEl.checked
        }
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.details || data.error || "Generation failed.");

    currentSuite = data;
    summaryEl.textContent = data.summary || "Test suite generated.";
    renderSuite();
    setMessage(`Generated ${data.testCases?.length || 0} test cases with ${data.metadata?.provider || "AI"}.`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    generateButton.disabled = false;
    generateButton.textContent = "Generate Test Cases";
  }
}

function renderSuite() {
  if (!currentSuite) return renderEmpty();

  if (currentTab === "cases") {
    outputEl.innerHTML = (currentSuite.testCases || []).map(renderCase).join("");
    return;
  }

  if (currentTab === "gherkin") {
    const gherkin = (currentSuite.gherkin || []).join("\n\n");
    outputEl.innerHTML = gherkin ? `<pre>${escapeHtml(gherkin)}</pre>` : `<div class="empty-state">No Gherkin output was requested.</div>`;
    return;
  }

  const risks = [
    ...(currentSuite.assumptions || []).map((item) => `Assumption: ${item}`),
    ...(currentSuite.risks || []).map((item) => `Risk: ${item}`)
  ];
  outputEl.innerHTML = risks.length
    ? `<ul class="test-case">${risks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<div class="empty-state">No risks or assumptions returned.</div>`;
}

function renderCase(testCase) {
  const priority = String(testCase.priority || "").toLowerCase();
  return `<article class="test-case">
    <div class="case-topline">
      <h3 class="case-title">${escapeHtml(testCase.id)} - ${escapeHtml(testCase.title)}</h3>
      <div class="badge-row">
        <span class="badge">${escapeHtml(testCase.type)}</span>
        <span class="badge ${priority}">${escapeHtml(testCase.priority)}</span>
      </div>
    </div>
    ${renderList("Preconditions", testCase.preconditions)}
    ${renderList("Steps", testCase.steps, "ol")}
    <div class="case-section"><strong>Expected Result</strong>${escapeHtml(testCase.expectedResult || "")}</div>
  </article>`;
}

function renderList(label, items = [], tag = "ul") {
  if (!items.length) return "";
  return `<div class="case-section"><strong>${label}</strong><${tag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}></div>`;
}

function renderEmpty() {
  outputEl.innerHTML = `<div class="empty-state">Paste a requirement and generate a test suite.</div>`;
}

function toCsv(testCases = []) {
  const rows = [
    ["ID", "Title", "Type", "Priority", "Preconditions", "Steps", "Expected Result"],
    ...testCases.map((item) => [
      item.id,
      item.title,
      item.type,
      item.priority,
      (item.preconditions || []).join(" | "),
      (item.steps || []).join(" | "),
      item.expectedResult
    ])
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value = "") {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("error", isError);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

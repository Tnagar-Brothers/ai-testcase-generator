import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const port = 31_000 + Math.floor(Math.random() * 1_000);
const baseUrl = `http://127.0.0.1:${port}`;
let serverProcess;

before(async () => {
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, AI_PROVIDER: "demo", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await waitForServer();
});

after(() => {
  serverProcess?.kill();
});

test("returns 400 when the requirement is too short", async () => {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirement: "short" })
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.details, "Please enter a user story or requirement with at least 20 characters.");
});

test("returns 400 when the request body is invalid JSON", async () => {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid"
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.details, "Request body must contain valid JSON.");
});

test("continues generating test cases for valid requirements", async () => {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requirement: "As a customer, I want to reset my password securely."
    })
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.metadata.provider, "demo");
  assert.ok(body.testCases.length > 0);
});

async function waitForServer() {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error("Test server exited before it became ready.");
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error("Timed out waiting for the test server.");
}

# AI Test Case Generator

A practical Node.js project that turns a Jira story, requirement, or acceptance criteria into:

- Functional test cases
- Edge cases
- Negative scenarios
- BDD / Gherkin scenarios
- CSV and `.feature` exports

The app runs in demo mode without an API key, then can be switched to OpenAI or Gemini by editing `.env`.

## Run Locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Configure AI

Create a `.env` file:

```bash
cp .env.example .env
```

For OpenAI:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o-mini
```

For Gemini:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-1.5-flash
```

Restart the server after changing `.env`.

## API

### `POST /api/generate`

Request:

```json
{
  "requirement": "As a customer, I want to reset my password...",
  "options": {
    "domain": "Web application",
    "riskLevel": "High",
    "includeGherkin": true,
    "includeEdgeCases": true,
    "includeNegative": true
  }
}
```

Response:

```json
{
  "summary": "short summary",
  "assumptions": [],
  "testCases": [],
  "gherkin": [],
  "risks": [],
  "metadata": {
    "provider": "demo",
    "model": "local-template",
    "generatedAt": "2026-05-05T00:00:00.000Z"
  }
}
```

## Resume Bullet

Built an AI-powered test case generator using Node.js and OpenAI/Gemini APIs to convert Jira-style requirements into functional, edge, negative, and BDD test scenarios with export support, reducing manual test design effort.

## Next Enhancements

- Jira issue import using Jira REST API
- qTest export format
- Authentication and saved projects
- Test case quality scoring
- Bulk generation from multiple stories

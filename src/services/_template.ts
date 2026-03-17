/**
 * Service Template
 *
 * Copy this file when adding a new service:
 * 1. Create schema:    src/schemas/{serviceName}.ts
 * 2. Copy this file:   src/services/{serviceName}.ts
 * 3. Add route:        src/routes/paid.ts
 * 4. Add x402 config:  src/middleware/x402.ts
 * 5. Update catalog:   src/routes/free.ts
 * 6. Add pricing:      .env (PRICE_{SERVICE_NAME}=$X.XX)
 * 7. Write tests:      tests/unit/{serviceName}.test.ts
 * 8. Run tests:        npm test
 * 9. Deploy:           docker build + push + restart
 * 10. Verify:          Hit endpoint on live server
 */

// import { callClaude } from '../llm/anthropic.js';
// import { yourInput, yourOutput, type YourInput, type YourOutput } from '../schemas/yourService.js';

/*
const SYSTEM_PROMPT = `You are a [role]. Given [input], you return ONLY valid JSON matching the exact schema below. No markdown, no preamble, no explanation outside the JSON.

Output JSON schema:
{
  "field1": <type>,
  "field2": <type>
}

Return ONLY the JSON object. Nothing else.`;

export async function yourService(input: YourInput): Promise<YourOutput> {
  const validated = yourInput.parse(input);
  const startTime = Date.now();

  const prompt = `Your prompt with ${validated.field}`;

  const raw = await callClaude({
    system: SYSTEM_PROMPT,
    userMessage: prompt,
    maxTokens: 1000,
    temperature: 0.2,
  });

  let parsed: unknown;
  try {
    const cleaned = raw.replace(/```json\s*|```\s*​/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  const result = yourOutput.parse({
    ...(parsed as Record<string, unknown>),
    metadata: {
      model: 'claude-sonnet-4-20250514',
      processingTimeMs: Date.now() - startTime,
    },
  });

  return result;
}
*/

/**
 * Cleans LLM output to extract valid JSON.
 * Handles common artifacts: markdown code fences, preamble text, trailing text.
 */
export function cleanLlmJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/gm, '') // Opening code fence
    .replace(/\s*```\s*$/gm, '') // Closing code fence
    .replace(/^[^{[]*/, '') // Anything before first { or [
    .replace(/[^}\]]*$/, '') // Anything after last } or ]
    .trim();
}

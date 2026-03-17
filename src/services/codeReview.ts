import { callClaude, type ClaudeResponse } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import {
  codeReviewInput,
  codeReviewOutput,
  type CodeReviewInput,
  type CodeReviewOutput,
} from '../schemas/codeReview.js';

const SYSTEM_PROMPT = `You are a security-focused smart contract and code auditor. Given source code, identify vulnerabilities, optimization opportunities, and best practice violations. You must return ONLY a JSON object. No markdown. No code fences. No preamble. No explanation.

Output JSON schema:
{
  "overallRisk": <"low"|"medium"|"high"|"critical">,
  "issues": [
    {
      "severity": <"info"|"low"|"medium"|"high"|"critical">,
      "category": <string, e.g. "reentrancy", "access_control", "gas_optimization">,
      "description": <string, clear description of the issue>,
      "line": <number or null, approximate line number>,
      "suggestion": <string, how to fix>
    }
  ],
  "summary": <string, one paragraph overall assessment>
}

Severity guide:
- critical: Funds at immediate risk, exploitable vulnerability
- high: Significant security concern, likely exploitable
- medium: Notable issue, potential for exploitation under certain conditions
- low: Minor concern, edge case or best practice violation
- info: Informational, style or optimization suggestion

For Solidity: check reentrancy, access control, integer overflow, unchecked external calls, frontrunning, oracle manipulation, storage layout, delegatecall risks.
For Rust: check memory safety, ownership issues, panic conditions, unsafe blocks.
For TypeScript: check injection vulnerabilities, type safety gaps, async error handling.

You must return ONLY a JSON object. No markdown. No code fences. No preamble. No explanation.`;

const GAS_PROMPT = `You are a gas optimization specialist for smart contracts and blockchain code. Given source code, identify gas optimization opportunities.

Return ONLY a JSON object:
{
  "estimatedSavings": <"none"|"minor"|"moderate"|"significant">,
  "suggestions": [
    {
      "location": <string, function name or line range>,
      "currentPattern": <string, current code pattern>,
      "suggestedPattern": <string, optimized alternative>,
      "estimatedGasSaved": <string, e.g. "~2,100 gas per call">,
      "difficulty": <"trivial"|"moderate"|"complex">
    }
  ],
  "summary": <string, one paragraph gas optimization summary>
}

You must return ONLY a JSON object. No markdown. No code fences.`;

const DIFF_PROMPT = `You are a code review specialist. You are given the PREVIOUS version and CURRENT version of code. Focus your security and quality review specifically on WHAT CHANGED between versions. Identify new vulnerabilities introduced, improvements made, and remaining issues in the changed code.

Output JSON schema:
{
  "overallRisk": <"low"|"medium"|"high"|"critical">,
  "issues": [
    {
      "severity": <"info"|"low"|"medium"|"high"|"critical">,
      "category": <string>,
      "description": <string, focus on changes>,
      "line": <number or null>,
      "suggestion": <string>
    }
  ],
  "summary": <string, one paragraph focusing on the diff assessment>
}

You must return ONLY a JSON object. No markdown. No code fences. No preamble.`;

export interface CodeReviewResult {
  output: CodeReviewOutput;
  estimatedCostUsd: number;
}

export async function reviewCode(
  input: CodeReviewInput,
): Promise<CodeReviewOutput> {
  const result = await reviewCodeWithCost(input);
  return result.output;
}

export async function reviewCodeWithCost(
  input: CodeReviewInput,
): Promise<CodeReviewResult> {
  const validated = codeReviewInput.parse(input);
  const startTime = Date.now();
  const linesAnalyzed = validated.code.split('\n').length;
  let totalCost = 0;

  // Determine if this is a diff review
  const isDiffReview = !!validated.previousCode;
  const wantGas = validated.focus === 'gas_optimization' || validated.focus === 'all';

  // Main review prompt
  let prompt: string;
  let systemPrompt: string;

  if (isDiffReview) {
    systemPrompt = DIFF_PROMPT;
    prompt = `Language: ${validated.language}
Focus: ${validated.focus}

PREVIOUS CODE:
\`\`\`${validated.language}
${validated.previousCode}
\`\`\`

CURRENT CODE:
\`\`\`${validated.language}
${validated.code}
\`\`\``;
  } else {
    systemPrompt = SYSTEM_PROMPT;
    prompt = `Language: ${validated.language}
Focus: ${validated.focus}
Lines: ${linesAnalyzed}

Code to review:
\`\`\`${validated.language}
${validated.code}
\`\`\``;
  }

  const response: ClaudeResponse = await callClaude({
    system: systemPrompt,
    userMessage: prompt,
    maxTokens: 3000,
    temperature: 0.1,
  });
  totalCost += response.usage.estimatedCostUsd;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanLlmJson(response.text));
  } catch {
    throw new Error(
      `LLM returned invalid JSON: ${response.text.slice(0, 200)}`,
    );
  }

  // Gas optimization analysis (separate LLM call)
  let gasOptimization: unknown;
  if (wantGas) {
    try {
      const gasResponse = await callClaude({
        system: GAS_PROMPT,
        userMessage: `Language: ${validated.language}\n\nCode:\n\`\`\`${validated.language}\n${validated.code}\n\`\`\``,
        maxTokens: 2000,
        temperature: 0.1,
      });
      totalCost += gasResponse.usage.estimatedCostUsd;
      gasOptimization = JSON.parse(cleanLlmJson(gasResponse.text));
    } catch {
      // Gas analysis failed — continue without it
    }
  }

  const output = codeReviewOutput.parse({
    ...(parsed as Record<string, unknown>),
    gasOptimization: gasOptimization ?? undefined,
    metadata: {
      model: 'claude-sonnet-4-20250514',
      processingTimeMs: Date.now() - startTime,
      linesAnalyzed,
    },
    relatedServices: [
      {
        endpoint: '/v1/contract-docs',
        description: 'Generate documentation for a deployed version of this contract',
        suggestedInput: { chain: 'ethereum' },
      },
    ],
  });

  return { output, estimatedCostUsd: totalCost };
}

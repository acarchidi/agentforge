import { describe, it, expect } from 'vitest';
import {
  codeReviewInput,
  codeReviewOutput,
} from '../../src/schemas/codeReview.js';

describe('Code Review Schema Validation', () => {
  it('accepts valid input with defaults', () => {
    const result = codeReviewInput.parse({
      code: 'pragma solidity ^0.8.0;',
    });
    expect(result.language).toBe('solidity');
    expect(result.focus).toBe('all');
  });

  it('accepts all valid languages', () => {
    for (const lang of [
      'solidity',
      'rust',
      'move',
      'typescript',
    ] as const) {
      const result = codeReviewInput.parse({ code: 'test', language: lang });
      expect(result.language).toBe(lang);
    }
  });

  it('accepts previousCode for diff review mode', () => {
    const result = codeReviewInput.parse({
      code: 'pragma solidity ^0.8.0; // v2',
      previousCode: 'pragma solidity ^0.8.0; // v1',
    });
    expect(result.previousCode).toBe('pragma solidity ^0.8.0; // v1');
  });

  it('accepts gas_optimization focus', () => {
    const result = codeReviewInput.parse({
      code: 'pragma solidity ^0.8.0;',
      focus: 'gas_optimization',
    });
    expect(result.focus).toBe('gas_optimization');
  });

  it('rejects empty code', () => {
    expect(() => codeReviewInput.parse({ code: '' })).toThrow();
  });

  it('validates output schema', () => {
    const output = codeReviewOutput.parse({
      overallRisk: 'medium',
      issues: [
        {
          severity: 'high',
          category: 'reentrancy',
          description: 'Potential reentrancy vulnerability',
          line: 42,
          suggestion: 'Use checks-effects-interactions pattern',
        },
      ],
      summary: 'The contract has moderate security concerns.',
      metadata: {
        model: 'test',
        processingTimeMs: 1000,
        linesAnalyzed: 100,
      },
    });
    expect(output.issues).toHaveLength(1);
    expect(output.overallRisk).toBe('medium');
  });

  it('validates output with gasOptimization', () => {
    const output = codeReviewOutput.parse({
      overallRisk: 'low',
      issues: [],
      gasOptimization: {
        estimatedSavings: 'moderate',
        suggestions: [
          {
            location: 'function transfer()',
            currentPattern: 'storage read in loop',
            suggestedPattern: 'cache storage variable before loop',
            estimatedGasSaved: '~2000 gas per iteration',
            difficulty: 'trivial',
          },
        ],
        summary: 'Several gas optimization opportunities found.',
      },
      summary: 'Contract is secure with gas optimization opportunities.',
      metadata: {
        model: 'test',
        processingTimeMs: 1500,
        linesAnalyzed: 200,
      },
    });
    expect(output.gasOptimization).toBeDefined();
    expect(output.gasOptimization!.estimatedSavings).toBe('moderate');
    expect(output.gasOptimization!.suggestions).toHaveLength(1);
    expect(output.gasOptimization!.suggestions[0].difficulty).toBe('trivial');
  });

  it('accepts all valid gasOptimization savings levels', () => {
    for (const level of ['none', 'minor', 'moderate', 'significant'] as const) {
      const output = codeReviewOutput.parse({
        overallRisk: 'low',
        issues: [],
        gasOptimization: {
          estimatedSavings: level,
          suggestions: [],
          summary: 'test',
        },
        summary: 'test',
        metadata: { model: 'test', processingTimeMs: 0, linesAnalyzed: 0 },
      });
      expect(output.gasOptimization!.estimatedSavings).toBe(level);
    }
  });

  it('rejects invalid overall risk', () => {
    expect(() =>
      codeReviewOutput.parse({
        overallRisk: 'extreme',
        issues: [],
        summary: 'test',
        metadata: { model: 'test', processingTimeMs: 0, linesAnalyzed: 0 },
      }),
    ).toThrow();
  });

  it('accepts output with relatedServices', () => {
    const output = codeReviewOutput.parse({
      overallRisk: 'low',
      issues: [],
      summary: 'test',
      metadata: { model: 'test', processingTimeMs: 0, linesAnalyzed: 10 },
      relatedServices: [
        { endpoint: '/v1/contract-docs', description: 'Generate docs', suggestedInput: { chain: 'ethereum' } },
      ],
    });
    expect(output.relatedServices).toHaveLength(1);
  });

  it('accepts output without relatedServices', () => {
    const output = codeReviewOutput.parse({
      overallRisk: 'low',
      issues: [],
      summary: 'test',
      metadata: { model: 'test', processingTimeMs: 0, linesAnalyzed: 10 },
    });
    expect(output.relatedServices).toBeUndefined();
  });
});

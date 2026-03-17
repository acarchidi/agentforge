/**
 * Prompt Verification Script
 *
 * Runs each service function with diverse inputs and verifies the output
 * passes Zod validation every time. Requires a valid ANTHROPIC_API_KEY.
 *
 * Usage: npm run verify:prompts
 */

import dotenv from 'dotenv';
dotenv.config();

import { analyzeSentiment } from '../src/services/sentiment.js';
import { summarize } from '../src/services/summarize.js';
import { reviewCode } from '../src/services/codeReview.js';
import { translate } from '../src/services/translate.js';

interface TestCase {
  name: string;
  fn: () => Promise<unknown>;
}

const tests: TestCase[] = [
  // Sentiment — diverse inputs
  {
    name: 'Sentiment: bullish crypto',
    fn: () =>
      analyzeSentiment({
        text: 'Bitcoin just hit $200k! This is insane!',
        context: 'crypto',
      }),
  },
  {
    name: 'Sentiment: Japanese bearish',
    fn: () =>
      analyzeSentiment({
        text: 'マーケットは下落しています',
        context: 'crypto',
      }),
  },
  {
    name: 'Sentiment: social media slang',
    fn: () =>
      analyzeSentiment({
        text: 'idk man feels mid tbh',
        context: 'social_media',
      }),
  },
  {
    name: 'Sentiment: neutral finance',
    fn: () =>
      analyzeSentiment({
        text: 'The Federal Reserve maintained rates at 5.25-5.50 basis points.',
        context: 'finance',
      }),
  },
  {
    name: 'Sentiment: emoji only',
    fn: () =>
      analyzeSentiment({ text: '🚀🚀🚀 LFG', context: 'social_media' }),
  },
  {
    name: 'Sentiment: minimal input',
    fn: () => analyzeSentiment({ text: 'a', context: 'general' }),
  },

  // Summarize
  {
    name: 'Summarize: repeated text brief',
    fn: () =>
      summarize({
        text: 'The quick brown fox jumped over the lazy dog. '.repeat(100),
        maxLength: 'brief',
        format: 'structured',
      }),
  },

  // Code review
  {
    name: 'Code review: Solidity reentrancy',
    fn: () =>
      reviewCode({
        code: `pragma solidity ^0.8.0;
contract Vault {
  mapping(address => uint) balances;
  function withdraw(uint amount) public {
    require(balances[msg.sender] >= amount);
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success);
    balances[msg.sender] -= amount;
  }
}`,
        language: 'solidity',
        focus: 'security',
      }),
  },

  // Translate
  {
    name: 'Translate: English to Spanish',
    fn: () =>
      translate({
        text: 'The market is showing signs of recovery.',
        targetLanguage: 'Spanish',
        tone: 'formal',
      }),
  },
];

async function main() {
  console.log('AgentForge Prompt Verification');
  console.log('==============================\n');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await test.fn();
      console.log(`  ✓ ${test.name}`);
      console.log(`    ${JSON.stringify(result).slice(0, 120)}...`);
      passed++;
    } catch (error) {
      console.error(
        `  ✗ ${test.name}`,
      );
      console.error(
        `    ${error instanceof Error ? error.message : error}`,
      );
      failed++;
    }
  }

  console.log(
    `\n${passed} passed, ${failed} failed out of ${tests.length} tests`,
  );
  if (failed > 0) {
    console.log(
      '\nFix failing prompts before deploying. The system prompt likely needs adjustment.',
    );
    process.exit(1);
  }
}

main().catch(console.error);

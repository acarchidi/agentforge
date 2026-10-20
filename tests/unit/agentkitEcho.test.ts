import { describe, it, expect } from 'vitest';
import { x402ResourceServer } from '@x402/core/server';
import { agentkitResourceServerExtension } from '@worldcoin/agentkit';
import { agentkitServerExtension, declareAgentkitTrial } from '../../src/middleware/agentkit.ts';

const PATH = '/v1/solana/tx-explain';
const requirements = [{
  scheme: 'exact',
  network: 'eip155:8453',
  amount: '50000',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x0000000000000000000000000000000000000001',
  maxTimeoutSeconds: 300,
  extra: { name: 'USD Coin', version: '2' },
}];
const resource = { url: `https://example.test${PATH}`, description: 'test', mimeType: 'application/json' };

/**
 * A client builds its payment from one 402 and echoes its extensions back;
 * the server re-issues a fresh 402 (new nonce/issuedAt) when it validates.
 */
async function echoAcrossTwo402s(extension: typeof agentkitResourceServerExtension) {
  const server = new x402ResourceServer();
  server.registerExtension(extension);
  const declared = declareAgentkitTrial(PATH);
  // structuredClone: the client receives a serialized copy, and the SDK writes enriched data back into the declaration.
  const first = structuredClone(await server.createPaymentRequiredResponse(requirements as never, resource, 'Payment required', { ...declared }));
  await new Promise((r) => setTimeout(r, 5)); // guarantee a different issuedAt
  const second = await server.createPaymentRequiredResponse(requirements as never, resource, 'Payment required', { ...declared });
  expect(first.extensions?.agentkit).not.toEqual(second.extensions?.agentkit);
  return server.validateExtensions(second, {
    x402Version: 2,
    resource,
    accepted: requirements[0],
    payload: {},
    extensions: first.extensions,
  } as never);
}

describe('agentkit extension echo', () => {
  it('upstream extension alone rejects an honest echo (the production bug)', async () => {
    expect((await echoAcrossTwo402s(agentkitResourceServerExtension)).valid).toBe(false);
  });

  it('registered extension accepts an echo from an earlier 402', async () => {
    expect(await echoAcrossTwo402s(agentkitServerExtension)).toEqual({ valid: true });
  });
});

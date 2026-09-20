/**
 * World AgentKit free trial (the `agentkit` x402 extension Exa uses).
 *
 * Agents whose wallet is registered in World's AgentBook (i.e. backed by a
 * verified human) can call the routes in AGENTKIT_TRIAL_ROUTES a limited
 * number of times without paying. After the trial the normal 402 flow applies.
 *
 * Usage counters and nonces live in the durable analytics store, keyed by a
 * salted hash of the World human id — the raw id is never stored.
 */
import {
  createAgentBookVerifier,
  createAgentkitHooks,
  declareAgentkitExtension,
  agentkitResourceServerExtension,
  type AgentKitStorage,
} from '@worldcoin/agentkit';
import { config } from '../config.js';
import { getStore } from '../analytics/store.js';
import { hashClientId } from '../analytics/clientId.js';
import { logEvent } from '../analytics/logger.js';

/** Paid routes that carry the free trial. program-lookup is already free and needs none. */
export const AGENTKIT_TRIAL_ROUTES = new Set(['/v1/solana/tx-explain']);

export const AGENTKIT_NETWORK = 'eip155:480'; // World Chain, where AgentBook lives
export const AGENTKIT_STATEMENT = 'Verify your agent is backed by a real human to unlock a free trial of AgentForge Solana tools';

export const AGENTKIT_HEADER = 'agentkit';

export function isAgentkitEnabled(): boolean {
  return config.AGENTKIT_ENABLED === 'true';
}

export function isAgentkitTrialRoute(path: string): boolean {
  return AGENTKIT_TRIAL_ROUTES.has(path);
}

/** Extension declaration to spread into a trial route's `extensions`. */
export function declareAgentkitTrial(resourcePath: string): Record<string, unknown> {
  return declareAgentkitExtension({
    resourceUri: `${config.PUBLIC_BASE_URL}${resourcePath}`,
    statement: AGENTKIT_STATEMENT,
    network: AGENTKIT_NETWORK,
    mode: { type: 'free-trial', uses: config.AGENTKIT_FREE_TRIAL_USES },
    expirationSeconds: 300,
  });
}

/** AgentKitStorage backed by the analytics store; human ids are hashed before storage. */
export const agentkitStorage: AgentKitStorage = {
  tryIncrementUsage: (endpoint, humanId, limit) =>
    getStore().tryIncrementUsage(endpoint, hashClientId(`agentkit-human:${humanId}`), limit),
  hasUsedNonce: (nonce) => getStore().hasUsedNonce(nonce),
  recordNonce: (nonce) => getStore().recordNonce(nonce),
};

let hooks: ReturnType<typeof createAgentkitHooks> | null = null;

export function getAgentkitHooks() {
  if (!hooks) {
    hooks = createAgentkitHooks({
      agentBook: createAgentBookVerifier(config.WORLDCHAIN_RPC_URL ? { rpcUrl: config.WORLDCHAIN_RPC_URL } : undefined),
      mode: { type: 'free-trial', uses: config.AGENTKIT_FREE_TRIAL_USES },
      storage: agentkitStorage,
      rpcUrls: config.WORLDCHAIN_RPC_URL ? { [AGENTKIT_NETWORK]: config.WORLDCHAIN_RPC_URL } : undefined,
      onEvent: (event) => {
        // Trial grants and exhaustion are conversion signals; log them distinctly.
        if (event.type === 'agent_verified' || event.type === 'discount_exhausted' || event.type === 'agent_not_verified') {
          void logEvent({
            kind: 'mcp',
            name: `agentkit:${event.type}`,
            chain: 'solana',
            success: event.type === 'agent_verified',
            clientHash: 'address' in event ? hashClientId(`agentkit-agent:${event.address}`) : undefined,
          });
        }
      },
    });
  }
  return hooks;
}

export { agentkitResourceServerExtension };

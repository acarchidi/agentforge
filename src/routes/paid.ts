import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getTokenIntelWithCost } from '../services/tokenIntel.js';
import { reviewCodeWithCost } from '../services/codeReview.js';
import { tokenResearchWithCost } from '../services/tokenResearch.js';
import { contractDocsWithCost } from '../services/contractDocs.js';
import { contractMonitorWithCost } from '../services/contractMonitor.js';
import { tokenCompareWithCost } from '../services/tokenCompare.js';
import { decodeTransactionWithCost } from '../services/txDecoder.js';
import { scanApprovalsWithCost } from '../services/approvalScanner.js';
import { getGasPriceWithCost } from '../services/gasOracle.js';
import { analyzeSentimentWithCost } from '../services/sentiment.js';
import { summarizeWithCost } from '../services/summarize.js';
import { translateWithCost } from '../services/translate.js';
import { walletSafetyWithCost } from '../services/walletSafety/index.js';
import { getPoolSnapshotWithCost } from '../services/poolSnapshots.js';
import { getTokenRiskMetricsWithCost } from '../services/tokenRiskMetrics/index.js';
import { explainSolanaTxWithCost } from '../services/solana/txExplain.js';
import { simulateSolanaTxWithCost } from '../services/solana/txSimulate.js';
import { scanSolanaTokenRiskWithCost } from '../services/solana/tokenRiskScan.js';
import { logEvent } from '../analytics/logger.js';
import { paymentContextFromRequest } from '../analytics/clientId.js';
import { ENDPOINT_PRICES } from '../pricing.js';

export const paidRouter = Router();

// Kept for callers that imported PRICES from this module.
export const PRICES = ENDPOINT_PRICES;

type ServiceFn = (input: any) => Promise<{ output: unknown; estimatedCostUsd: number }>;

/** Chain requested, when the input carries one; Solana routes are implicit. */
function chainOf(endpoint: string, input: Record<string, unknown> | undefined): string | undefined {
  if (endpoint.startsWith('/v1/solana/')) return 'solana';
  const chain = input?.chain;
  return typeof chain === 'string' ? chain : undefined;
}

function classifyError(error: unknown): string {
  if (error instanceof z.ZodError) return 'validation';
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  if (/timeout|timed out|etimedout/.test(msg)) return 'upstream_timeout';
  if (/429|rate limit/.test(msg)) return 'upstream_rate_limit';
  if (/not found|404/.test(msg)) return 'not_found';
  if (/anthropic|claude|llm/.test(msg)) return 'llm';
  return 'internal';
}

/**
 * Shared request lifecycle for every paid route: run the service, log ONE
 * analytics event carrying latency, success, error class, requested chain,
 * payment network/scheme, and the hashed payer — then respond.
 */
async function handlePaid(
  req: Request,
  res: Response,
  endpoint: string,
  serviceFn: ServiceFn,
  input: unknown,
): Promise<void> {
  const startTime = Date.now();
  const payment = paymentContextFromRequest(req);
  const inputObj = (input && typeof input === 'object' ? input : undefined) as Record<string, unknown> | undefined;
  const base = {
    kind: 'paid' as const,
    name: endpoint,
    chain: chainOf(endpoint, inputObj),
    clientHash: payment.clientHash,
    paymentNetwork: payment.paymentNetwork,
    paymentScheme: payment.paymentScheme,
  };

  try {
    const result = await serviceFn(input);
    const latencyMs = Date.now() - startTime;
    await logEvent({
      ...base,
      success: true,
      latencyMs,
      inputSize: input === undefined ? undefined : JSON.stringify(input).length,
      outputSize: JSON.stringify(result.output).length,
      amountUsd: ENDPOINT_PRICES[endpoint] ?? 0,
      estimatedCostUsd: result.estimatedCostUsd,
    });
    res.json(result.output);
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorClass = classifyError(error);
    await logEvent({ ...base, success: false, latencyMs, errorClass });

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: error.issues.map((e) => ({ path: e.path.join('.'), message: e.message })),
      });
      return;
    }
    console.error(`${endpoint} error:`, error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

function createHandler(endpoint: string, serviceFn: ServiceFn) {
  return (req: Request, res: Response) => handlePaid(req, res, endpoint, serviceFn, req.body);
}

// Paid endpoints
paidRouter.post('/v1/token-intel', createHandler('/v1/token-intel', getTokenIntelWithCost));
paidRouter.post('/v1/code-review', createHandler('/v1/code-review', reviewCodeWithCost));
paidRouter.post('/v1/token-research', createHandler('/v1/token-research', tokenResearchWithCost));
paidRouter.post('/v1/contract-docs', createHandler('/v1/contract-docs', contractDocsWithCost));
paidRouter.post('/v1/contract-monitor', createHandler('/v1/contract-monitor', contractMonitorWithCost));
paidRouter.post('/v1/token-compare', createHandler('/v1/token-compare', tokenCompareWithCost));
paidRouter.post('/v1/tx-decode', createHandler('/v1/tx-decode', decodeTransactionWithCost));
paidRouter.post('/v1/approval-scan', createHandler('/v1/approval-scan', scanApprovalsWithCost));
paidRouter.post('/v1/sentiment', createHandler('/v1/sentiment', analyzeSentimentWithCost));
paidRouter.post('/v1/summarize', createHandler('/v1/summarize', summarizeWithCost));
paidRouter.post('/v1/translate', createHandler('/v1/translate', translateWithCost));
paidRouter.post('/v1/wallet-safety', createHandler('/v1/wallet-safety', walletSafetyWithCost));
paidRouter.post('/v1/token-risk-metrics', createHandler('/v1/token-risk-metrics', getTokenRiskMetricsWithCost));
paidRouter.post('/v1/solana/tx-explain', createHandler('/v1/solana/tx-explain', explainSolanaTxWithCost));
paidRouter.post('/v1/solana/tx-simulate', createHandler('/v1/solana/tx-simulate', simulateSolanaTxWithCost));
paidRouter.post('/v1/solana/token-risk-scan', createHandler('/v1/solana/token-risk-scan', scanSolanaTokenRiskWithCost));

// Gas oracle — GET endpoint, chain from query param
paidRouter.get('/v1/gas', (req: Request, res: Response) =>
  handlePaid(req, res, '/v1/gas', getGasPriceWithCost, { chain: (req.query.chain as string | undefined) ?? undefined }));

// Pool snapshot — GET endpoint, query params
paidRouter.get('/v1/pool-snapshot', (req: Request, res: Response) =>
  handlePaid(req, res, '/v1/pool-snapshot', getPoolSnapshotWithCost, req.query));

// Ping — minimal paid endpoint to verify x402 flow
paidRouter.get('/v1/ping', (req: Request, res: Response) =>
  handlePaid(req, res, '/v1/ping', async () => ({
    output: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'Payment verified. AgentForge is operational.',
    },
    estimatedCostUsd: 0,
  }), undefined));

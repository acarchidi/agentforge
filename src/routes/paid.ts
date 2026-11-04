import { Router, type Request, type Response } from 'express';
import { withPitch } from '../discovery/pitch.js';
import { z } from 'zod';
import { getTokenIntelWithCost } from '../services/tokenIntel.js';
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
import { tradeCheckWithCost } from '../services/tradeCheck.js';
import { contentScanWithCost } from '../services/contentScan.js';
import { riskBatchWithCost } from '../services/riskBatch.js';
import { addressCheckWithCost } from '../services/addressCheck.js';
import { getLaunchesWithCost } from '../services/launches.js';
import { simulateEvmTxWithCost } from '../services/txSimulate.js';
import { getLendingHealthWithCost } from '../services/lendingHealth.js';
import { signatureCheckWithCost } from '../services/signatureCheck.js';
import { preflightWithCost } from '../services/preflight.js';
import { createWatchWithCost } from '../services/watch.js';
import { logEvent } from '../analytics/logger.js';
import { config } from '../config.js';
import { hashClientId, paymentContextFromRequest, clientTagOf } from '../analytics/clientId.js';
import { refundCreditPayment, type CreditPayment } from '../middleware/credits.js';
import { ENDPOINT_PRICES, PUBLIC_BASE_URL, formatUsd, priceFor } from '../pricing.js';
import { packFor } from '../credits/auth.js';
import { pingCatalog } from '../discovery/upsell.js';

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
  const credit = res.locals.payment as CreditPayment | undefined;
  const payment = credit?.scheme === 'credits'
    ? { clientHash: hashClientId(credit.wallet), paymentNetwork: 'credits', paymentScheme: 'credits' }
    : paymentContextFromRequest(req);
  const viaAgentkitTrial = !payment.paymentNetwork && typeof req.headers['agentkit'] === 'string';
  const inputObj = (input && typeof input === 'object' ? input : undefined) as Record<string, unknown> | undefined;
  const base = {
    kind: 'paid' as const,
    name: endpoint,
    chain: chainOf(endpoint, inputObj),
    clientHash: payment.clientHash,
    paymentNetwork: payment.paymentNetwork,
    paymentScheme: viaAgentkitTrial ? 'agentkit-free-trial' : payment.paymentScheme,
    clientTag: clientTagOf(req),
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
      amountUsd: viaAgentkitTrial ? 0 : priceFor(endpoint, input),
      estimatedCostUsd: result.estimatedCostUsd,
    });
    res.json(withPitch(endpoint, result.output, { paidWithCredits: credit?.scheme === 'credits' }));
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorClass = classifyError(error);
    await Promise.all([
      logEvent({ ...base, success: false, latencyMs, errorClass }),
      refundCreditPayment(res, endpoint),
    ]);

    if (error instanceof z.ZodError) {
      // A failed first call is where most would-be customers are lost; give
      // the caller what it needs to retry instead of a dead end.
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: error.issues.map((e) => ({ path: e.path.join('.'), message: e.message })),
        docs: `${PUBLIC_BASE_URL}/openapi.json`,
        hint: `Input and output schemas for every endpoint, with examples: ${PUBLIC_BASE_URL}/catalog`,
      });
      return;
    }
    // Unknown tx signature / mint / contract: the caller's input, not our fault.
    // Any status >= 400 skips settlement, so the caller is not charged either way.
    if (errorClass === 'not_found') {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: error instanceof Error ? error.message : 'Not found',
      });
      return;
    }
    console.error(`${endpoint} error:`, error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
      charged: false,
      report: `Something wrong? POST ${PUBLIC_BASE_URL}/feedback or email ${config.CONTACT_EMAIL}`,
    });
  }
}

function createHandler(endpoint: string, serviceFn: ServiceFn) {
  return (req: Request, res: Response) => handlePaid(req, res, endpoint, serviceFn, req.body);
}

// Paid endpoints
paidRouter.post('/v1/token-intel', createHandler('/v1/token-intel', getTokenIntelWithCost));
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
paidRouter.post('/v1/trade-check', createHandler('/v1/trade-check', tradeCheckWithCost));
paidRouter.post('/v1/risk-batch', createHandler('/v1/risk-batch', riskBatchWithCost));
paidRouter.post('/v1/address-check', createHandler('/v1/address-check', addressCheckWithCost));
// Buying credits: the balance is credited in the x402 settlement hook (keyed by
// the settlement tx hash), so a failed or duplicate settlement never credits.
paidRouter.post('/v1/credits/buy', async (req: Request, res: Response) => {
  const packId = String(req.query.pack ?? (req.body as { pack?: unknown } | undefined)?.pack ?? '1');
  const pack = packFor(packId);
  if (!pack) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'pack must be 1, 5 or 20', packs: `${PUBLIC_BASE_URL}/credits/balance` });
    return;
  }
  const payment = paymentContextFromRequest(req);
  if (!payment.payer || !/^0x[0-9a-fA-F]{40}$/.test(payment.payer)) {
    res.status(400).json({ error: 'EVM_WALLET_REQUIRED', message: 'Credits are bought and spent with an EVM wallet paying in USDC on Base.' });
    return;
  }
  const wallet = payment.payer.toLowerCase();
  const priceUsd = Number(pack.priceMicro) / 1e6;
  const ref = typeof req.query.ref === 'string' && /^0x[0-9a-fA-F]{40}$/.test(req.query.ref) && req.query.ref.toLowerCase() !== wallet
    ? req.query.ref.toLowerCase()
    : null;
  await logEvent({
    kind: 'paid',
    name: '/v1/credits/buy',
    success: true,
    clientHash: payment.clientHash,
    paymentNetwork: payment.paymentNetwork,
    paymentScheme: payment.paymentScheme,
    amountUsd: priceUsd,
    estimatedCostUsd: 0,
  });
  res.json({
    status: 'credited_on_settlement',
    wallet,
    pack: packId,
    priceUsd: formatUsd(priceUsd),
    creditUsd: formatUsd(Number(pack.creditMicro) / 1e6),
    bonusPct: pack.bonusPct,
    ...(ref ? { referrer: ref, referralBonusPct: 5, note: 'A referrer applies on your first referred purchase and stays attached; if one was already set, that one is kept.' } : {}),
    referral: `Share ${PUBLIC_BASE_URL}/v1/credits/buy?pack=5&ref=${wallet}: you earn 10% of every pack the wallets you refer buy, as credit; they get 5% extra.`,
    balanceUrl: `${PUBLIC_BASE_URL}/credits/balance?wallet=${wallet}`,
    howToSpend: `Sign each request and send it in the X-AgentForge-Credit header: ${PUBLIC_BASE_URL}/SKILL.md#prepaid-credits`,
  });
});

paidRouter.post('/v1/watch', createHandler('/v1/watch', createWatchWithCost));
paidRouter.post('/v1/preflight', createHandler('/v1/preflight', preflightWithCost));
paidRouter.post('/v1/content-scan', createHandler('/v1/content-scan', contentScanWithCost));
paidRouter.post('/v1/tx-simulate', createHandler('/v1/tx-simulate', simulateEvmTxWithCost));
paidRouter.post('/v1/signature-check', createHandler('/v1/signature-check', signatureCheckWithCost));

// Aave v3 position health — GET, query params
paidRouter.get('/v1/lending/health', (req: Request, res: Response) =>
  handlePaid(req, res, '/v1/lending/health', getLendingHealthWithCost, req.query));

// New-launch feed — GET, query params
paidRouter.get('/v1/launches', (req: Request, res: Response) =>
  handlePaid(req, res, '/v1/launches', getLaunchesWithCost, req.query));
paidRouter.post('/v1/solana/tx-explain', createHandler('/v1/solana/tx-explain', explainSolanaTxWithCost));
paidRouter.post('/v1/solana/tx-simulate', createHandler('/v1/solana/tx-simulate', simulateSolanaTxWithCost));
paidRouter.post('/v1/solana/token-risk-scan', createHandler('/v1/solana/token-risk-scan', scanSolanaTokenRiskWithCost));

// Gas oracle — GET endpoint, chain from query param
paidRouter.get('/v1/gas', (req: Request, res: Response) =>
  handlePaid(req, res, '/v1/gas', getGasPriceWithCost, { chain: (req.query.chain as string | undefined) ?? undefined }));

// Pool snapshot — GET endpoint, query params
paidRouter.get('/v1/pool-snapshot', (req: Request, res: Response) =>
  handlePaid(req, res, '/v1/pool-snapshot', getPoolSnapshotWithCost, req.query));

// Ping — paid x402 smoke test. Every first-time payer lands here, so the pong
// carries the service catalog (static strings only; still zero marginal cost).
paidRouter.get('/v1/ping', (req: Request, res: Response) =>
  handlePaid(req, res, '/v1/ping', async () => ({
    output: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'Payment verified. AgentForge is operational.',
      ...pingCatalog(),
    },
    estimatedCostUsd: 0,
  }), undefined));

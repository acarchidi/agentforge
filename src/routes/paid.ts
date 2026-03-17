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
import { logCall, logRevenue } from '../analytics/logger.js';

export const paidRouter = Router();

// Price per endpoint (parsed from config strings)
const PRICES: Record<string, number> = {
  '/v1/token-intel': 0.015,
  '/v1/code-review': 0.05,
  '/v1/token-research': 0.04,
  '/v1/contract-docs': 0.02,
  '/v1/contract-monitor': 0.025,
  '/v1/token-compare': 0.08,
  '/v1/tx-decode': 0.01,
  '/v1/approval-scan': 0.015,
  '/v1/gas': 0.003,
  '/v1/sentiment': 0.008,
  '/v1/summarize': 0.01,
  '/v1/translate': 0.015,
  '/v1/wallet-safety': 0.035,
  '/v1/ping': 0.001,
};

// Handler factory with cost tracking
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createHandler(
  endpoint: string,
  serviceFn: (input: any) => Promise<{ output: unknown; estimatedCostUsd: number }>,
) {
  return async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      const result = await serviceFn(req.body);

      const latencyMs = Date.now() - startTime;
      logCall({
        endpoint,
        success: true,
        latencyMs,
        inputSize: JSON.stringify(req.body).length,
        outputSize: JSON.stringify(result.output).length,
      });

      // Log revenue with real cost data
      logRevenue(
        endpoint,
        PRICES[endpoint] ?? 0,
        result.estimatedCostUsd,
        (req.headers['x-payment-response'] as string) ?? undefined,
      );

      res.json(result.output);
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof z.ZodError) {
        logCall({
          endpoint,
          success: false,
          latencyMs,
          errorType: 'validation',
        });
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: error.issues.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }

      logCall({ endpoint, success: false, latencyMs, errorType: 'internal' });
      console.error(`${endpoint} error:`, error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message:
          error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
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

// Gas oracle — GET endpoint, chain from query param
paidRouter.get('/v1/gas', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const endpoint = '/v1/gas';
  try {
    const chain = (req.query.chain as string | undefined) ?? undefined;
    const result = await getGasPriceWithCost({ chain } as any);
    const latencyMs = Date.now() - startTime;
    logCall({ endpoint, success: true, latencyMs, outputSize: JSON.stringify(result.output).length });
    logRevenue(endpoint, PRICES[endpoint] ?? 0, result.estimatedCostUsd);
    res.json(result.output);
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    if (error instanceof z.ZodError) {
      logCall({ endpoint, success: false, latencyMs, errorType: 'validation' });
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: error.issues.map((e) => ({ path: e.path.join('.'), message: e.message })),
      });
      return;
    }
    logCall({ endpoint, success: false, latencyMs, errorType: 'internal' });
    console.error(`${endpoint} error:`, error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Ping — minimal paid endpoint to verify x402 flow
paidRouter.get('/v1/ping', (_req: Request, res: Response) => {
  logCall({ endpoint: '/v1/ping', success: true, latencyMs: 0 });
  logRevenue('/v1/ping', PRICES['/v1/ping'] ?? 0.001, 0);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Payment verified. AgentForge is operational.',
  });
});

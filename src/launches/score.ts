/**
 * Launch risk score (0 = safe, 100 = extremely risky) for a newly created
 * pool. Pure and deterministic — no LLM — so a launch is scored once and the
 * same result is sold to every feed poller. Market signals are re-scored as
 * trading activity accrues; on-chain facts are fetched once.
 */

import type { TokenFacts } from './onchain.js';
import type { PoolActivity } from '../services/dataSources/geckoterminal.js';

export interface LaunchMarket {
  liquidityUsd: number | null;
  fdvUsd: number | null;
  txH24: PoolActivity;
}

export interface LaunchRisk {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  flags: string[];
}

function level(score: number): LaunchRisk['level'] {
  if (score < 25) return 'low';
  if (score < 50) return 'medium';
  if (score < 75) return 'high';
  return 'critical';
}

export function scoreLaunch(facts: TokenFacts, market: LaunchMarket): LaunchRisk {
  let score = 0;
  const flags: string[] = [];
  const add = (points: number, flag: string) => {
    score += points;
    flags.push(flag);
  };

  // Admin control. No owner() at all is not proof of safety (AccessControl,
  // custom roles), so it is treated like an active owner.
  const adminActive = !facts.ownerRenounced;
  const who = facts.owner === null ? 'An admin role' : 'The owner';

  if (facts.verified === false) add(15, 'Contract source is not verified');
  else if (facts.verified === null) add(5, 'Verification status unavailable');

  if (facts.isProxy) add(20, 'Upgradeable proxy — logic can be replaced after launch');
  if (adminActive && facts.capabilities.mint) add(25, `${who} can mint new supply`);
  if (adminActive && facts.capabilities.blacklist) add(20, `${who} can blacklist wallets (common honeypot mechanism)`);
  if (adminActive && facts.capabilities.feeSetter) add(15, `${who} can change trading taxes`);
  if (adminActive && facts.capabilities.pause) add(10, `${who} can pause transfers`);
  if (adminActive && facts.capabilities.maxTxSetter) add(5, `${who} can change max transaction / wallet limits`);

  const held = facts.creatorHoldingPct;
  if (held !== undefined) {
    if (held >= 50) add(30, `Deployer still holds ${held.toFixed(1)}% of supply`);
    else if (held >= 20) add(20, `Deployer still holds ${held.toFixed(1)}% of supply`);
    else if (held >= 5) add(10, `Deployer still holds ${held.toFixed(1)}% of supply`);
  }

  const inPool = facts.supplyInPoolPct;
  if (inPool !== undefined) {
    if (inPool < 20) add(20, `Only ${inPool.toFixed(1)}% of supply is in the liquidity pool — the rest is held off-pool`);
    else if (inPool < 50) add(10, `Only ${inPool.toFixed(1)}% of supply is in the liquidity pool`);
  }

  const liq = market.liquidityUsd;
  if (liq === null) add(10, 'Liquidity unknown');
  else if (liq < 1_000) add(20, `Very thin liquidity ($${Math.round(liq)})`);
  else if (liq < 10_000) add(10, `Thin liquidity ($${Math.round(liq)})`);
  if (liq !== null && market.fdvUsd && market.fdvUsd > 0 && liq / market.fdvUsd < 0.02) {
    add(10, `Liquidity is only ${((liq / market.fdvUsd) * 100).toFixed(2)}% of FDV`);
  }

  // Honeypot signature: people buy but nobody manages to sell.
  const { buys, sells, buyers, sellers } = market.txH24;
  if (buys >= 10 && sells === 0) add(40, `No sells despite ${buys} buys in 24h — possible honeypot`);
  else if (buyers >= 20 && sellers / buyers < 0.05) add(20, `Only ${sellers} sellers vs ${buyers} buyers in 24h — selling may be restricted`);
  else if (buys + sells < 10) add(10, 'Too little trading yet to rule out a honeypot');

  const clamped = Math.min(100, score);
  return { score: clamped, level: level(clamped), flags };
}

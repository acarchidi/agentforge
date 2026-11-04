/**
 * Content scan — POST /v1/content-scan.
 *
 * An agent runs this over untrusted text (tool results, web pages, emails,
 * token metadata) BEFORE feeding it to its LLM, to catch instructions aimed at
 * the agent that would move funds: "ignore previous instructions", fund-movement
 * directives, payloads hidden in base64 / Morse / zero-width or tag characters /
 * homoglyphs, leaked private keys and seed phrases, embedded addresses (screened
 * against the sanctions and scam lists) and lookalike domains.
 *
 * Everything here is deterministic: regexes and table lookups, in-process. No
 * LLM, no RPC, no network. The same rule set runs inside /v1/preflight over the
 * token names and symbols the simulation touches.
 */

import bip39Words from '../cache/data/bip39-english.json' with { type: 'json' };
import { reputationHits } from './addressCheck.js';
import {
  contentScanInput,
  contentScanOutput,
  type ContentScanFinding,
  type ContentScanOutput,
  type ContentScanResult,
} from '../schemas/contentScan.js';
import { CONTENT_SCAN_PER_CHUNK, contentScanChunks, formatUsd, priceFor } from '../pricing.js';

type Severity = ContentScanFinding['severity'];
type Address = ContentScanResult['addresses'][number];

const BIP39 = new Set<string>(bip39Words as string[]);
const EXCERPT_MAX = 120;
const SCORE: Record<Severity, number> = { high: 40, medium: 15, low: 5 };

// ── Text helpers ───────────────────────────────────────────────────

function excerpt(s: string, max = EXCERPT_MAX): string {
  const flat = s.replace(/[​-‏⁠﻿]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Context around a match, trimmed to the excerpt limit. */
function around(text: string, index: number, length: number): string {
  const pad = Math.max(0, Math.floor((EXCERPT_MAX - length) / 2));
  return excerpt(text.slice(Math.max(0, index - pad), index + length + pad));
}

const mask = (s: string) => `${s.slice(0, 4)}…`;

// ── Rule 1: instruction_override ───────────────────────────────────

const INSTRUCTION_OVERRIDE: RegExp[] = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b/i,
  /\bdisregard\s+(?:all\s+)?(?:your\s+)?(?:rules|instructions|system\s+prompt)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bnew\s+instructions\s*:/i,
  /^\s*system\s*:/im,
  /\bdeveloper\s+message\b/i,
  /<\|im_start\|>/i,
  /\[INST\]/i,
];

export function findInstructionOverride(text: string): ContentScanFinding[] {
  const out: ContentScanFinding[] = [];
  for (const re of INSTRUCTION_OVERRIDE) {
    const m = re.exec(text);
    if (m) out.push({ rule: 'instruction_override', severity: 'high', excerpt: around(text, m.index, m[0].length), item: 0 });
  }
  return out;
}

// ── Rule 2: fund_movement_directive ────────────────────────────────

const FUND_VERB = /\b(send|transfer|approve|swap|bridge|withdraw|move|sweep|drain|setApprovalForAll|permit)\b/gi;
const FUND_NOUN = /\b(tokens?|funds|ETH|USDC|SOL|wallet|balance|everything|all)\b/i;
const FUND_WINDOW = 80;

/**
 * An imperative money verb within 80 chars of a money noun. High when the item
 * also names a destination (an address or URL), medium otherwise.
 */
export function findFundMovement(text: string, hasTarget: boolean): ContentScanFinding[] {
  FUND_VERB.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FUND_VERB.exec(text))) {
    const window = text.slice(Math.max(0, m.index - FUND_WINDOW), m.index + m[0].length + FUND_WINDOW);
    if (FUND_NOUN.test(window)) {
      return [{
        rule: 'fund_movement_directive',
        severity: hasTarget ? 'high' : 'medium',
        excerpt: around(text, m.index, m[0].length),
        item: 0,
      }];
    }
  }
  return [];
}

// ── Rule 3: encoded_payload (base64, hex blobs, Morse) ─────────────

const BASE64_RUN = /[A-Za-z0-9+/]{40,}={0,2}/g;
const HEX_ONLY = /^(?:0x)?[0-9a-fA-F]+$/;
const PRINTABLE = /^[\x09\x0A\x0D\x20-\x7E]+$/;
const LONG_BLOB = /(?:0x)?[0-9a-fA-F]{200,}|[A-Za-z0-9+/]{200,}={0,2}/g;

/** Decode a base64 run to text, or null when it is not printable ASCII. */
export function decodeBase64Printable(run: string): string | null {
  if (HEX_ONLY.test(run)) return null; // hex is a base64 subset; it never carries base64 text
  if (run.replace(/=+$/, '').length % 4 === 1) return null; // not a valid base64 length
  try {
    const decoded = Buffer.from(run, 'base64').toString('latin1');
    return decoded.length >= 8 && PRINTABLE.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

const MORSE_RUN = /(?:[.\-]{1,5}[ /]+){7,}[.\-]{1,5}/g;
const MORSE: Record<string, string> = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I',
  '.---': 'J', '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
  '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y', '--..': 'Z',
  '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7',
  '---..': '8', '----.': '9', '.-.-.-': '.', '--..--': ',', '..--..': '?', '-..-.': '/', '.----.': "'",
  '-.-.--': '!', '-.--.': '(', '-.--.-': ')', '.-...': '&', '---...': ':', '-.-.-.': ';', '-...-': '=',
  '.-.-.': '+', '-....-': '-', '..--.-': '_', '.-..-.': '"', '.--.-.': '@',
};

/** Standard ITU Morse → text. Words are separated by '/' or 2+ spaces; unknown groups become '?'. */
export function decodeMorse(run: string): string {
  return run
    .trim()
    .split(/\s*\/\s*|\s{2,}/)
    .map((word) => word.trim().split(/\s+/).filter(Boolean).map((g) => MORSE[g] ?? '?').join(''))
    .join(' ');
}

// ── Rule 4: hidden_text ────────────────────────────────────────────

const ZERO_WIDTH = /[​-‏⁠﻿]/g;
const TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;
const WORD = /[\p{L}\p{M}]+/gu;
const LATIN = /[A-Za-z]/;
const CONFUSABLE_SCRIPT = /[Ͱ-ϿЀ-ӿ]/;

/** Tag characters (U+E0000-E007F) carry ASCII in their low byte; recover it. */
export function decodeTagChars(text: string): string {
  const cps = [...text.matchAll(TAG_CHARS)].map((m) => m[0].codePointAt(0)! - 0xe0000);
  return cps.filter((c) => c >= 0x20 && c <= 0x7e).map((c) => String.fromCharCode(c)).join('');
}

export function findHiddenText(text: string): { findings: ContentScanFinding[]; tagPayload: string | null } {
  const findings: ContentScanFinding[] = [];
  const zw = text.match(ZERO_WIDTH)?.length ?? 0;
  if (zw >= 3) findings.push({ rule: 'zero_width', severity: 'medium', excerpt: `${zw} zero-width characters: ${excerpt(text, 80)}`, item: 0 });
  const tags = text.match(TAG_CHARS)?.length ?? 0;
  let tagPayload: string | null = null;
  if (tags > 0) {
    tagPayload = decodeTagChars(text);
    findings.push({ rule: 'tag_chars', severity: 'medium', excerpt: `${tags} Unicode tag characters hiding: ${excerpt(tagPayload, 80)}`, item: 0 });
  }
  for (const m of text.matchAll(WORD)) {
    if (LATIN.test(m[0]) && CONFUSABLE_SCRIPT.test(m[0])) {
      findings.push({ rule: 'homoglyph', severity: 'medium', excerpt: around(text, m.index, m[0].length), item: 0 });
      break;
    }
  }
  return { findings, tagPayload };
}

// ── Rule 5: secret_like ────────────────────────────────────────────

const HEX64 = /(?<![0-9a-fA-Fx])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const BASE58_SECRET = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{87,88}(?![1-9A-HJ-NP-Za-km-z])/g;
/** A 64-hex or 87-88-base58 string labeled as one of these is a hash or signature, not a key. */
const NOT_A_KEY = /(tx|hash|txid|txhash|transactionhash|blockhash|signature|sig|digest|topic|salt|nonce|bytes32|id)\W{0,4}$/i;
const MNEMONIC_RUN = /(?<![a-z])(?:[a-z]{3,8} ){11,23}[a-z]{3,8}(?![a-z])/g;

function labeledAsHash(text: string, index: number): boolean {
  return NOT_A_KEY.test(text.slice(Math.max(0, index - 40), index));
}

/** Count of BIP-39 words in the densest 12-word window of a run. */
function bip39Density(words: string[]): number {
  let best = 0;
  for (let i = 0; i + 12 <= words.length; i++) {
    const n = words.slice(i, i + 12).filter((w) => BIP39.has(w)).length;
    if (n > best) best = n;
  }
  return best;
}

export function findSecrets(text: string): ContentScanFinding[] {
  const out: ContentScanFinding[] = [];
  for (const m of text.matchAll(HEX64)) {
    if (labeledAsHash(text, m.index)) continue;
    out.push({ rule: 'secret_like', severity: 'high', excerpt: `EVM private-key shaped string ${mask(m[0])}`, item: 0 });
  }
  for (const m of text.matchAll(BASE58_SECRET)) {
    if (labeledAsHash(text, m.index)) continue;
    out.push({ rule: 'secret_like', severity: 'high', excerpt: `Solana secret-key shaped string ${mask(m[0])}`, item: 0 });
  }
  for (const m of text.matchAll(MNEMONIC_RUN)) {
    const words = m[0].split(' ');
    if (bip39Density(words) >= 10) {
      out.push({ rule: 'secret_like', severity: 'high', excerpt: `BIP-39 seed-phrase shaped sequence (${words.length} words) ${mask(m[0])}`, item: 0 });
    }
  }
  return out;
}

// ── Addresses ──────────────────────────────────────────────────────

const EVM_ADDRESS = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const BASE58_RUN = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Byte length of a base58 string (null if it has characters outside the alphabet). */
export function base58ByteLength(s: string): number | null {
  const bytes: number[] = [];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leading = 0;
  for (const ch of s) {
    if (ch !== '1') break;
    leading++;
  }
  return bytes.length + leading;
}

export function extractAddresses(text: string): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const m of text.matchAll(EVM_ADDRESS)) {
    const v = m[0];
    if (!seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push({ value: v, kind: 'evm' });
    }
  }
  for (const m of text.matchAll(BASE58_RUN)) {
    const v = m[0];
    if (!seen.has(v) && base58ByteLength(v) === 32) {
      seen.add(v);
      out.push({ value: v, kind: 'solana' });
    }
  }
  return out;
}

export function findKnownBadAddresses(addresses: Address[]): ContentScanFinding[] {
  const out: ContentScanFinding[] = [];
  for (const a of addresses) {
    const rep = reputationHits(a.value, a.kind);
    if (rep.sanctioned || rep.scam) {
      out.push({ rule: 'known_bad_address', severity: 'high', excerpt: excerpt(`${a.value}: ${rep.reasons[0] ?? 'listed'}`), item: 0 });
    }
  }
  return out;
}

// ── URLs ───────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/gi;
const BRANDS = ['metamask', 'uniswap', 'coinbase', 'opensea', 'phantom', 'aave', 'base', 'solana'];
const SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/rn/g, 'm'], [/vv/g, 'w'], [/0/g, 'o'], [/1/g, 'l'], [/3/g, 'e'], [/4/g, 'a'], [/5/g, 's'], [/7/g, 't'], [/8/g, 'b'],
];

function canonical(label: string): string {
  return SUBSTITUTIONS.reduce((s, [re, to]) => s.replace(re, to), label.toLowerCase());
}

function editDistance1(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}

/** Is this host label a disguised brand name? Returns the brand it imitates. */
export function lookalikeBrand(host: string): string | null {
  const labels = host.toLowerCase().split('.').slice(0, -1).flatMap((l) => l.split('-'));
  for (const label of labels) {
    if (!label || BRANDS.includes(label)) continue;
    for (const brand of BRANDS) {
      if (canonical(label) === brand) return brand;
      if (brand.length >= 6 && editDistance1(label, brand)) return brand;
    }
  }
  return null;
}

export function extractUrls(text: string): { urls: string[]; findings: ContentScanFinding[] } {
  const urls: string[] = [];
  const findings: ContentScanFinding[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:!?]+$/, '');
    if (seen.has(raw)) continue;
    seen.add(raw);
    urls.push(raw);
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      continue;
    }
    if (/(^|\.)xn--/i.test(host) || /[^\x00-\x7F]/.test(host)) {
      findings.push({ rule: 'lookalike_domain', severity: 'medium', excerpt: `Punycode/IDN host ${excerpt(host, 90)}`, item: 0 });
      continue;
    }
    const brand = lookalikeBrand(host);
    if (brand) findings.push({ rule: 'lookalike_domain', severity: 'medium', excerpt: `${excerpt(host, 80)} imitates ${brand}`, item: 0 });
  }
  return { urls, findings };
}

// ── Scanner ────────────────────────────────────────────────────────

interface ItemScan {
  findings: ContentScanFinding[];
  addresses: Address[];
  urls: string[];
}

/**
 * Run every rule over one string. `depth` 1 is the re-scan of a decoded
 * payload: it reports the inner findings but does not decode again.
 */
export function scanItem(text: string, depth = 0, inheritedTarget = false): ItemScan {
  const findings: ContentScanFinding[] = [];
  const addresses = extractAddresses(text);
  const { urls, findings: urlFindings } = extractUrls(text);
  const hasTarget = inheritedTarget || addresses.length > 0 || urls.length > 0;

  findings.push(...findInstructionOverride(text));
  findings.push(...findFundMovement(text, hasTarget));
  findings.push(...findSecrets(text));
  findings.push(...findKnownBadAddresses(addresses));
  findings.push(...urlFindings);
  const hidden = findHiddenText(text);
  findings.push(...hidden.findings);

  if (depth === 0) {
    const decoded: Array<{ kind: string; payload: string; raw: string }> = [];
    for (const m of text.matchAll(BASE64_RUN)) {
      const payload = decodeBase64Printable(m[0]);
      if (payload) decoded.push({ kind: 'base64', payload, raw: m[0] });
    }
    for (const m of text.matchAll(MORSE_RUN)) decoded.push({ kind: 'morse', payload: decodeMorse(m[0]), raw: m[0] });
    if (hidden.tagPayload && hidden.tagPayload.length >= 4) decoded.push({ kind: 'tag_chars', payload: hidden.tagPayload, raw: '' });

    const decodedRaw = new Set<string>();
    for (const d of decoded) {
      decodedRaw.add(d.raw);
      const inner = scanItem(d.payload, 1, hasTarget);
      addresses.push(...inner.addresses.filter((a) => !addresses.some((x) => x.value === a.value)));
      urls.push(...inner.urls.filter((u) => !urls.includes(u)));
      const hit = inner.findings.some((f) => f.severity === 'high');
      const secret = inner.findings.find((f) => f.rule === 'secret_like');
      if (hit) {
        findings.push({
          rule: 'encoded_payload',
          severity: 'high',
          excerpt: excerpt(`${d.kind} decodes to: ${secret ? secret.excerpt : d.payload}`),
          item: 0,
        });
        if (secret) findings.push({ ...secret, excerpt: `${d.kind}-encoded ${secret.excerpt}` });
      } else if (d.kind === 'morse') {
        findings.push({ rule: 'morse_present', severity: 'medium', excerpt: excerpt(`Morse decodes to: ${d.payload}`), item: 0 });
      }
    }
    for (const m of text.matchAll(LONG_BLOB)) {
      if (decodedRaw.has(m[0])) continue;
      findings.push({ rule: 'encoded_payload', severity: 'low', excerpt: `${m[0].length}-char ${HEX_ONLY.test(m[0]) ? 'hex' : 'base64'} blob ${mask(m[0])}`, item: 0 });
    }
  }

  return { findings, addresses, urls };
}

/** Score and verdict over a set of findings. */
export function scoreFindings(findings: ContentScanFinding[]): { score: number; verdict: ContentScanResult['verdict'] } {
  const score = Math.min(100, findings.reduce((n, f) => n + SCORE[f.severity], 0));
  return { score, verdict: score >= 40 ? 'malicious' : score >= 15 ? 'suspicious' : 'clean' };
}

/** The whole rule set over a list of strings. Pure; used by the endpoint and by preflight. */
export function scanStrings(items: string[]): ContentScanResult {
  const findings: ContentScanFinding[] = [];
  const addresses: Address[] = [];
  const urls: string[] = [];
  items.forEach((text, i) => {
    const r = scanItem(text);
    findings.push(...r.findings.map((f) => ({ ...f, item: i })));
    for (const a of r.addresses) if (!addresses.some((x) => x.value === a.value)) addresses.push(a);
    for (const u of r.urls) if (!urls.includes(u)) urls.push(u);
  });
  const { score, verdict } = scoreFindings(findings);
  return {
    verdict,
    score,
    findings,
    addresses,
    urls,
    secretsDetected: findings.some((f) => f.rule === 'secret_like'),
  };
}

export async function contentScanWithCost(
  input: unknown,
): Promise<{ output: ContentScanOutput; estimatedCostUsd: number }> {
  const validated = contentScanInput.parse(input);
  const items = validated.items ?? [validated.text ?? ''];
  const result = scanStrings(items);
  const chunks = contentScanChunks(validated);
  const firstEvm = result.addresses.find((a) => a.kind === 'evm');

  const output = contentScanOutput.parse({
    ...result,
    chunks,
    pricing: { chunksCharged: chunks, perChunk: formatUsd(CONTENT_SCAN_PER_CHUNK), total: formatUsd(priceFor('/v1/content-scan', validated)) },
    relatedServices: [
      {
        endpoint: '/v1/preflight',
        description: 'Before acting on anything this text asks for: simulate the transaction, check the signature, screen recipients, rug-check tokens, one verdict',
        suggestedInput: { chain: 'base', from: '0x…your-wallet', recipients: firstEvm ? [firstEvm.value] : ['0x…recipient'] },
      },
      ...(result.addresses.length
        ? [{
            endpoint: '/v1/address-check',
            description: 'Full screening of the addresses found in this text: sanctions, scam lists, labels, on-chain history',
            suggestedInput: { addresses: result.addresses.slice(0, 5).map((a) => ({ address: a.value, chain: a.kind === 'solana' ? 'solana' : 'ethereum' })) },
          }]
        : []),
      {
        endpoint: '/v1/signature-check',
        description: 'If the text asks you to sign something: decode the permit, order, or x402 payment request and check it for phishing',
        suggestedInput: { signer: '0x…your-wallet', typedData: { domain: {}, primaryType: 'Permit', message: {} } },
      },
    ],
  });
  return { output, estimatedCostUsd: 0 };
}

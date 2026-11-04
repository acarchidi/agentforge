/**
 * Webhook delivery for watches: SSRF-safe URL validation, Stripe-style
 * signatures, and a single bounded POST.
 *
 * The URL is re-validated on every delivery (DNS can change after creation),
 * redirects are never followed, and only https on 443 to public addresses is
 * allowed.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as dns } from 'node:dns';
import net from 'node:net';
import { config } from '../config.js';

export class WebhookUrlError extends Error {}

function ipv4Blocked(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast + reserved
  );
}

export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4Blocked(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Blocked(mapped[1]);
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') || // unique local
    /^fe[89ab]/.test(v6) || // link-local
    v6.startsWith('ff') || // multicast
    v6.startsWith('64:ff9b:') // NAT64 can reach private v4
  );
}

export async function validateWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError('webhookUrl is not a valid URL');
  }
  if (url.protocol !== 'https:') throw new WebhookUrlError('webhookUrl must use https');
  if (url.port && url.port !== '443') throw new WebhookUrlError('webhookUrl must use the default https port');
  if (url.username || url.password) throw new WebhookUrlError('webhookUrl must not contain credentials');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) throw new WebhookUrlError('webhookUrl must use a hostname, not an IP address');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new WebhookUrlError('webhookUrl must be a public host');
  }
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new WebhookUrlError('webhookUrl host does not resolve');
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new WebhookUrlError('webhookUrl must resolve only to public addresses');
  }
  return url;
}

/** Per-watch secret: derived, never stored. Requires WATCH_MASTER_KEY. */
export function watchSecret(watchId: string): string {
  if (!config.WATCH_MASTER_KEY) throw new Error('watches disabled: WATCH_MASTER_KEY is not set');
  return createHmac('sha256', config.WATCH_MASTER_KEY).update(watchId).digest('base64url');
}

export function checkWatchSecret(watchId: string, given: unknown): boolean {
  if (typeof given !== 'string' || !config.WATCH_MASTER_KEY) return false;
  const expected = Buffer.from(watchSecret(watchId));
  const got = Buffer.from(given);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** `t=<unix>,v1=<hex HMAC_SHA256(secret, t + "." + body)>` */
export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function deliverWebhook(url: string, watchId: string, payload: unknown, timeoutMs = 5000): Promise<DeliveryResult> {
  try {
    await validateWebhookUrl(url);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'invalid url' };
  }
  const body = JSON.stringify(payload);
  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'AgentForge-Webhooks/1.0',
        'x-agentforge-signature': signPayload(watchSecret(watchId), body),
      },
      body,
    });
    await res.body?.cancel().catch(() => {});
    return res.status >= 200 && res.status < 300 ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'delivery failed' };
  }
}

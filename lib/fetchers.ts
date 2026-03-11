import { Exchange, Kline, Timeframe } from './types';

const BINANCE_LIMIT = 1000;
const OKX_LIMIT = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;
const klineCache = new Map<string, { data: Kline[]; ts: number }>();

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function normalizeBinance(data: any[]): Kline[] {
  return data.map((d) => ({
    time: Number(d[0]),
    open: Number(d[1]),
    high: Number(d[2]),
    low: Number(d[3]),
    close: Number(d[4]),
    volume: Number(d[5]),
  }));
}

function okxBar(tf: Timeframe): string {
  if (tf === '5m') return '5m';
  if (tf === '15m') return '15m';
  if (tf === '1h') return '1H';
  return '4H';
}

function normalizeOkx(data: any[]): Kline[] {
  return data.map((d) => ({
    time: Number(d[0]),
    open: Number(d[1]),
    high: Number(d[2]),
    low: Number(d[3]),
    close: Number(d[4]),
    volume: Number(d[5]),
  })).sort((a, b) => a.time - b.time);
}

async function fetchBinanceKlines(symbol: string, timeframe: Timeframe, startTime?: number, endTime?: number, limit = 500): Promise<Kline[]> {
  if (!startTime && !endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${timeframe}&limit=${Math.min(limit, BINANCE_LIMIT)}`;
    return normalizeBinance(await fetchJson(url));
  }

  const out: Kline[] = [];
  let cursor = startTime ?? 0;
  const hardEnd = endTime ?? Date.now();
  while (cursor < hardEnd && out.length < limit) {
    const batchLimit = Math.min(BINANCE_LIMIT, limit - out.length);
    const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${timeframe}&limit=${batchLimit}&startTime=${cursor}&endTime=${hardEnd}`;
    const data = normalizeBinance(await fetchJson(url));
    if (!data.length) break;
    out.push(...data);
    const lastTime = data[data.length - 1].time;
    cursor = lastTime + 1;
    if (data.length < batchLimit) break;
  }
  return out;
}

async function fetchOkxKlines(symbol: string, timeframe: Timeframe, startTime?: number, endTime?: number, limit = 500): Promise<Kline[]> {
  const instId = symbol.includes('-') ? symbol : symbol.replace('USDT', '-USDT');
  if (!startTime && !endTime) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${encodeURIComponent(instId)}&bar=${okxBar(timeframe)}&limit=${Math.min(limit, OKX_LIMIT)}`;
    const json = await fetchJson(url);
    return normalizeOkx(json.data || []);
  }

  const out: Kline[] = [];
  let after: number | undefined = endTime;
  while (out.length < limit) {
    const batchLimit = Math.min(OKX_LIMIT, limit - out.length);
    const params = new URLSearchParams({ instId, bar: okxBar(timeframe), limit: String(batchLimit) });
    if (after) params.set('after', String(after));
    const url = `https://www.okx.com/api/v5/market/history-candles?${params.toString()}`;
    const json = await fetchJson(url);
    const data = normalizeOkx(json.data || []);
    if (!data.length) break;
    const filtered = data.filter((k) => (!startTime || k.time >= startTime) && (!endTime || k.time <= endTime));
    out.unshift(...filtered);
    const oldest = data[0].time;
    after = oldest - 1;
    if (oldest <= (startTime ?? 0) || data.length < batchLimit) break;
  }
  return out.slice(-limit);
}

export async function fetchKlines(exchange: Exchange, symbol: string, timeframe: Timeframe, startTime?: number, endTime?: number, limit = 500): Promise<Kline[]> {
  const key = `${exchange}:${symbol}:${timeframe}:${startTime ?? ''}:${endTime ?? ''}:${limit}`;
  const cached = klineCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const raw = exchange === 'binance'
    ? await fetchBinanceKlines(symbol, timeframe, startTime, endTime, limit)
    : await fetchOkxKlines(symbol, timeframe, startTime, endTime, limit);

  const normalized = raw
    .filter((k) => Number.isFinite(k.open) && Number.isFinite(k.close))
    .sort((a, b) => a.time - b.time)
    .filter((k, i, arr) => i === 0 || k.time !== arr[i - 1].time);

  klineCache.set(key, { data: normalized, ts: Date.now() });
  return normalized;
}

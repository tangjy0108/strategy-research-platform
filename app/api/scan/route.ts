export const runtime = 'nodejs';
export const maxDuration = 60;
import { NextRequest, NextResponse } from 'next/server';
import { fetchKlines } from '@/lib/fetchers';
import { runBacktest } from '@/lib/backtest';
import { BacktestParams, ScanParamKey, ScanResponse } from '@/lib/types';

const allowedKeys: ScanParamKey[] = ['adxThreshold', 'rrTarget', 'snrStrength', 'stopAtrMult', 'signalGap', 'volumeThreshold'];

function sanitizeKey(key: unknown, fallback: ScanParamKey): ScanParamKey {
  return typeof key === 'string' && allowedKeys.includes(key as ScanParamKey) ? (key as ScanParamKey) : fallback;
}

function sanitizeValues(values: unknown, fallback: number[]) {
  if (!Array.isArray(values)) return fallback;
  const out = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!out.length) return fallback;
  return out.slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const base = (await req.json()) as BacktestParams;
    const klines = await fetchKlines(base.exchange, base.symbol, base.timeframe, base.startTime, base.endTime, base.limit || 800);

    const defaultX = base.strategy === 'snr_fvg_lq_tc' ? 'snrStrength' : 'adxThreshold';
    const xKey = sanitizeKey(base.scanXKey, defaultX);
    const yKey = sanitizeKey(base.scanYKey, 'rrTarget');
    const xValues = sanitizeValues(base.scanXValues, base.strategy === 'snr_fvg_lq_tc' ? [8, 12, 15, 20] : [18, 20, 22, 25]);
    const yValues = sanitizeValues(base.scanYValues, [1.5, 2.0, 2.5, 3.0]);

    if (xValues.length * yValues.length > 100) {
      return NextResponse.json({ error: 'Scan grid too large. Please keep total cells <= 100.' }, { status: 400 });
    }

    const cells: ScanResponse['cells'] = [];
    for (const x of xValues) {
      for (const y of yValues) {
        const params = {
          ...base,
          [xKey]: x,
          [yKey]: y,
        } as BacktestParams;
        const result = runBacktest(klines, params);
        cells.push({
          x,
          y,
          totalTrades: result.summary.totalTrades,
          winRate: result.summary.winRate,
          profitFactor: result.summary.profitFactor,
          expectancyR: result.summary.expectancyR,
          maxDrawdownPct: result.summary.maxDrawdownPct,
        });
      }
    }

    return NextResponse.json({ xKey, yKey, xValues, yValues, cells } satisfies ScanResponse);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

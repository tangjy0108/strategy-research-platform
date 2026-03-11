export const runtime = 'nodejs';
export const maxDuration = 60;
import { NextRequest, NextResponse } from 'next/server';
import { runBacktest } from '@/lib/backtest';
import { fetchKlines } from '@/lib/fetchers';
import { BacktestParams } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const params = (await req.json()) as BacktestParams;
    const klines = await fetchKlines(
      params.exchange,
      params.symbol,
      params.timeframe,
      params.startTime,
      params.endTime,
      params.limit || 800,
    );

    if (klines.length < 50) {
      return NextResponse.json({ error: 'K 線資料太少，無法回測。' }, { status: 400 });
    }

    const result = runBacktest(klines, params);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const maxDuration = 60;
import { NextRequest, NextResponse } from 'next/server';
import { fetchKlines } from '@/lib/fetchers';
import { Exchange, Timeframe } from '@/lib/types';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const exchange = (searchParams.get('exchange') || 'binance') as Exchange;
    const symbol = searchParams.get('symbol') || 'BTCUSDT';
    const timeframe = (searchParams.get('timeframe') || '15m') as Timeframe;
    const limit = Number(searchParams.get('limit') || 500);
    const startTime = searchParams.get('startTime') ? Number(searchParams.get('startTime')) : undefined;
    const endTime = searchParams.get('endTime') ? Number(searchParams.get('endTime')) : undefined;

    const klines = await fetchKlines(exchange, symbol, timeframe, startTime, endTime, limit);
    return NextResponse.json({
      exchange,
      symbol,
      timeframe,
      count: klines.length,
      firstTime: klines[0]?.time ?? null,
      lastTime: klines[klines.length - 1]?.time ?? null,
      klines,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

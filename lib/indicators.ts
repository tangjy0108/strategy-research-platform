import { Kline } from './types';

export function ema(values: number[], length: number): number[] {
  const out: number[] = [];
  const alpha = 2 / (length + 1);
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i += 1) {
    prev = i === 0 ? values[i] : alpha * values[i] + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

export function rma(values: number[], length: number): number[] {
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i += 1) {
    prev = i === 0 ? values[i] : (prev * (length - 1) + values[i]) / length;
    out.push(prev);
  }
  return out;
}

export function atr(klines: Kline[], length: number): number[] {
  const trs = klines.map((k, i) => {
    if (i === 0) return k.high - k.low;
    const prevClose = klines[i - 1].close;
    return Math.max(k.high - k.low, Math.abs(k.high - prevClose), Math.abs(k.low - prevClose));
  });
  return rma(trs, length);
}

export function adx(klines: Kline[], length: number): number[] {
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 0; i < klines.length; i += 1) {
    if (i === 0) {
      tr.push(klines[i].high - klines[i].low);
      plusDM.push(0);
      minusDM.push(0);
      continue;
    }
    const upMove = klines[i].high - klines[i - 1].high;
    const downMove = klines[i - 1].low - klines[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      klines[i].high - klines[i].low,
      Math.abs(klines[i].high - klines[i - 1].close),
      Math.abs(klines[i].low - klines[i - 1].close),
    ));
  }

  const trRma = rma(tr, length);
  const plusRma = rma(plusDM, length);
  const minusRma = rma(minusDM, length);
  const dx: number[] = trRma.map((trValue, i) => {
    const pdi = trValue === 0 ? 0 : (100 * plusRma[i]) / trValue;
    const mdi = trValue === 0 ? 0 : (100 * minusRma[i]) / trValue;
    const denom = pdi + mdi;
    return denom === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / denom;
  });
  return rma(dx, length);
}

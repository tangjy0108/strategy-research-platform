import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Strategy Research Platform v2',
  description: 'Binance / OKX based strategy research and backtest platform MVP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}

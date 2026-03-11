import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Strategy Research Platform v3.2.3',
  description: 'Binance / OKX strategy research, backtest & parameter optimisation platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="bg-[#F0F2F5] text-[#1E293B] antialiased">{children}</body>
    </html>
  );
}

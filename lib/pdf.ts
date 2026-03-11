'use client';

import type { BacktestResponse } from './types';

export async function downloadPdfReport(result: BacktestResponse) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const lines = result.reportMarkdown.split('\n');
  let y = 40;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line || ' ', 520);
    for (const chunk of wrapped) {
      if (y > 780) {
        doc.addPage();
        y = 40;
      }
      doc.text(chunk, 40, y);
      y += 16;
    }
  }
  doc.save(`research-report-${result.params.symbol}-${result.params.strategy}.pdf`);
}

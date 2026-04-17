/**
 * Client-side CSV download and chart PNG export utilities.
 */

/** Download a CSV file from headers + rows */
export function downloadCSV(
  headers: string[],
  rows: string[][],
  filename: string,
): void {
  const escape = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ];
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Export a Chart.js chart as PNG download */
export function exportChartAsPNG(
  chartRef: { toBase64Image: () => string } | null | undefined,
  filename: string,
): void {
  if (!chartRef) return;
  const base64 = chartRef.toBase64Image();
  const a = document.createElement('a');
  a.href = base64;
  a.download = filename;
  a.click();
}

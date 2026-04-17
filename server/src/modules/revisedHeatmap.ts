import type { HeatmapRow, OTRecommendation } from '../types.js';

const ALL_INTERVALS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

function intervalIndex(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 2 + (m >= 30 ? 1 : 0);
}

/**
 * Computes a revised heatmap by adding OT headcount back to the intervals
 * covered by each OT recommendation.
 */
export function computeRevisedHeatmap(
  originalData: HeatmapRow[],
  recommendations: OTRecommendation[],
): HeatmapRow[] {
  const dataMap = new Map<string, number>();
  for (const row of originalData) {
    const key = `${row.date}|${row.program}|${row.intervalStartTime}`;
    dataMap.set(key, row.overUnderValue);
  }

  for (const rec of recommendations) {
    const timeWindow = rec.otTimeWindow;
    const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(timeWindow);
    if (!match) continue;

    const startIdx = intervalIndex(match[1]);
    let endIdx = intervalIndex(match[2]);
    if (endIdx <= startIdx) endIdx += 48;

    for (let i = startIdx; i < endIdx; i++) {
      const actualIdx = i % 48;
      const interval = ALL_INTERVALS[actualIdx];
      const key = `${rec.date}|${rec.program}|${interval}`;
      const current = dataMap.get(key);
      if (current !== undefined) {
        dataMap.set(key, current + 1);
      }
    }
  }

  return originalData.map((row) => {
    const key = `${row.date}|${row.program}|${row.intervalStartTime}`;
    return { ...row, overUnderValue: dataMap.get(key) ?? row.overUnderValue };
  });
}

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
 *
 * For each recommendation:
 * - Parse the OT time window (e.g. "05:00-07:00") or handle "Full Day"
 * - Add +1 to each half-hour interval in that window for that date/program
 */
export function computeRevisedHeatmap(
  originalData: HeatmapRow[],
  recommendations: OTRecommendation[],
): HeatmapRow[] {
  // Build a deltaMap that only tracks the +1 adjustments from OT recommendations
  const deltaMap = new Map<string, number>();

  for (const rec of recommendations) {
    const timeWindow = rec.otTimeWindow;
    let startIdx: number;
    let endIdx: number;

    if (timeWindow === 'Full Day') {
      startIdx = 0;
      endIdx = 48;
    } else {
      // Parse time window like "05:00-07:00" or "07:00-16:00"
      const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(timeWindow);
      if (!match) continue;

      startIdx = intervalIndex(match[1]);
      endIdx = intervalIndex(match[2]);

      // Handle overnight shifts (e.g. 23:00-08:00)
      if (endIdx <= startIdx) endIdx += 48;
    }

    for (let i = startIdx; i < endIdx; i++) {
      const actualIdx = i % 48;
      const interval = ALL_INTERVALS[actualIdx];
      const key = `${rec.date}|${rec.program}|${interval}`;
      deltaMap.set(key, (deltaMap.get(key) ?? 0) + 1);
    }
  }

  // Apply deltas to original data — each row uses its own original value as the base
  return originalData.map((row) => {
    const key = `${row.date}|${row.program}|${row.intervalStartTime}`;
    const delta = deltaMap.get(key) ?? 0;
    return {
      ...row,
      overUnderValue: row.overUnderValue + delta,
    };
  });
}

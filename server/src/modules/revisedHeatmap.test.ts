import { describe, it, expect } from 'vitest';
import { computeRevisedHeatmap } from './revisedHeatmap.js';
import type { HeatmapRow, OTRecommendation } from '../types.js';

describe('revisedHeatmap', () => {
  it('should add +1 to intervals covered by recommendations', () => {
    const original: HeatmapRow[] = [
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '06:00', overUnderValue: -3 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '06:30', overUnderValue: -4 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '07:00', overUnderValue: -2 },
    ];

    const recs: OTRecommendation[] = [{
      date: '2026-04-15', program: 'P1', lobby: '', agent: 'A1', manager: 'M1',
      shift: '07:00-16:00', otType: '1hr Pre Shift OT',
      otTimeWindow: '06:00-07:00', deficitBlock: '05:00-07:00',
    }];

    const revised = computeRevisedHeatmap(original, recs);
    expect(revised[0].overUnderValue).toBe(-2); // 06:00: -3 + 1
    expect(revised[1].overUnderValue).toBe(-3); // 06:30: -4 + 1
    expect(revised[2].overUnderValue).toBe(-2); // 07:00: not covered
  });

  it('should handle empty recommendations', () => {
    const original: HeatmapRow[] = [
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '06:00', overUnderValue: -3 },
    ];
    const revised = computeRevisedHeatmap(original, []);
    expect(revised).toEqual(original);
  });

  it('should handle multiple recommendations', () => {
    const original: HeatmapRow[] = [
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '06:00', overUnderValue: -5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '06:30', overUnderValue: -5 },
    ];

    const recs: OTRecommendation[] = [
      { date: '2026-04-15', program: 'P1', lobby: '', agent: 'A1', manager: 'M1', shift: '07:00-16:00', otType: '1hr Pre Shift OT', otTimeWindow: '06:00-07:00', deficitBlock: '05:00-07:00' },
      { date: '2026-04-15', program: 'P1', lobby: '', agent: 'A2', manager: 'M1', shift: '07:00-16:00', otType: '1hr Pre Shift OT', otTimeWindow: '06:00-07:00', deficitBlock: '05:00-07:00' },
    ];

    const revised = computeRevisedHeatmap(original, recs);
    expect(revised[0].overUnderValue).toBe(-3); // -5 + 2
    expect(revised[1].overUnderValue).toBe(-3); // -5 + 2
  });
});

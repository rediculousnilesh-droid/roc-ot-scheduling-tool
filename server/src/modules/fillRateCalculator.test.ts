import { describe, it, expect } from 'vitest';
import {
  calculateOverallFillRate, calculateFillRateByProgram, calculateFillRateByManager,
  calculateFillRateByDate, calculateAllFillRates, getWeek,
} from './fillRateCalculator.js';
import type { OTSlot, ShiftRoster } from '../types.js';

function makeSlot(overrides: Partial<OTSlot> = {}): OTSlot {
  return {
    id: `slot_${Math.random()}`, otType: '1hr Pre Shift OT', date: '2026-04-15',
    program: 'P1', lobby: '', timeWindow: '06:00-07:00', status: 'Released',
    assignedAgentId: null, assignedAgentName: null,
    createdAt: '2026-01-01T00:00:00Z', releasedAt: '2026-01-01T00:00:00Z',
    filledAt: null, filledByAgentId: null, filledByAgentName: null, returnedAt: null,
    ...overrides,
  };
}

const roster: ShiftRoster = {
  entries: [
    { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-15', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false },
    { agent: 'A2', program: 'P2', lobby: '', manager: 'M2', date: '2026-04-15', shiftStart: '08:00', shiftEnd: '17:00', isWeeklyOff: false },
  ],
  agents: ['A1', 'A2'], managers: ['M1', 'M2'], programs: ['P1', 'P2'], lobbies: [], dates: ['2026-04-15'],
};

describe('fillRateCalculator', () => {
  describe('getWeek', () => {
    it('should return ISO week string', () => {
      const week = getWeek('2026-04-15');
      expect(week).toMatch(/^\d{4}-W\d{2}$/);
    });
  });

  describe('calculateOverallFillRate', () => {
    it('should calculate fill rate correctly', () => {
      const slots = [
        makeSlot({ status: 'Released' }),
        makeSlot({ status: 'Filled' }),
        makeSlot({ status: 'Created' }), // excluded
        makeSlot({ status: 'Cancelled' }), // excluded
      ];
      const result = calculateOverallFillRate(slots);
      expect(result.totalReleased).toBe(2); // Released + Filled
      expect(result.totalFilled).toBe(1);
      expect(result.fillRate).toBe(50);
    });

    it('should return null fill rate when no relevant slots', () => {
      const slots = [makeSlot({ status: 'Created' })];
      const result = calculateOverallFillRate(slots);
      expect(result.fillRate).toBeNull();
    });
  });

  describe('calculateFillRateByProgram', () => {
    it('should group by program', () => {
      const slots = [
        makeSlot({ program: 'P1', status: 'Released' }),
        makeSlot({ program: 'P1', status: 'Filled' }),
        makeSlot({ program: 'P2', status: 'Released' }),
      ];
      const result = calculateFillRateByProgram(slots);
      expect(result.get('P1')?.fillRate).toBe(50);
      expect(result.get('P2')?.fillRate).toBe(0);
    });
  });

  describe('calculateFillRateByManager', () => {
    it('should group by manager via roster', () => {
      const slots = [
        makeSlot({ program: 'P1', status: 'Filled' }),
        makeSlot({ program: 'P2', status: 'Released' }),
      ];
      const result = calculateFillRateByManager(slots, roster);
      expect(result.get('M1')?.fillRate).toBe(100);
      expect(result.get('M2')?.fillRate).toBe(0);
    });
  });

  describe('calculateFillRateByDate', () => {
    it('should group by date', () => {
      const slots = [
        makeSlot({ date: '2026-04-15', status: 'Filled' }),
        makeSlot({ date: '2026-04-15', status: 'Released' }),
        makeSlot({ date: '2026-04-16', status: 'Filled' }),
      ];
      const result = calculateFillRateByDate(slots);
      expect(result.get('2026-04-15')?.fillRate).toBe(50);
      expect(result.get('2026-04-16')?.fillRate).toBe(100);
    });
  });

  describe('calculateAllFillRates', () => {
    it('should compute all fill rate groupings', () => {
      const slots = [
        makeSlot({ program: 'P1', status: 'Filled' }),
        makeSlot({ program: 'P1', status: 'Released' }),
      ];
      const result = calculateAllFillRates(slots, roster);
      expect(result.overall.fillRate).toBe(50);
      expect(result.byProgram['P1']?.fillRate).toBe(50);
      expect(result.byManager['M1']?.fillRate).toBe(50);
    });
  });
});

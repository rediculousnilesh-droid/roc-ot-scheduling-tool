import { describe, it, expect } from 'vitest';
import { serializeSlotsToCSV, serializeFillRatesToCSV } from './exportService.js';
import type { OTSlot, ShiftRoster, AllFillRates } from '../types.js';

describe('exportService', () => {
  const roster: ShiftRoster = {
    entries: [
      { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-15', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false },
    ],
    agents: ['A1'], managers: ['M1'], programs: ['P1'], lobbies: [], dates: ['2026-04-15'],
  };

  describe('serializeSlotsToCSV', () => {
    it('should produce valid CSV with headers', () => {
      const slots: OTSlot[] = [{
        id: 'slot_1', otType: '1hr Pre Shift OT', date: '2026-04-15', program: 'P1', lobby: '',
        timeWindow: '06:00-07:00', status: 'Created', assignedAgentId: 'A1', assignedAgentName: 'A1',
        createdAt: '2026-01-01T00:00:00Z', releasedAt: null, filledAt: null,
        filledByAgentId: null, filledByAgentName: null, returnedAt: null,
      }];
      const csv = serializeSlotsToCSV(slots, roster);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Date,Week,Program,OT_Type,Time_Window,Slot_Status,Assigned_Agent,Manager');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('2026-04-15');
      expect(lines[1]).toContain('P1');
    });

    it('should handle empty slots', () => {
      const csv = serializeSlotsToCSV([], roster);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(1); // headers only
    });
  });

  describe('serializeFillRatesToCSV', () => {
    it('should produce valid fill rate CSV', () => {
      const fillRates: AllFillRates = {
        overall: { totalReleased: 10, totalFilled: 5, fillRate: 50 },
        byProgram: { P1: { totalReleased: 10, totalFilled: 5, fillRate: 50 } },
        byManager: {},
        byDate: {},
        byWeek: {},
        byProgramWeek: {},
        byManagerWeek: {},
      };
      const csv = serializeFillRatesToCSV(fillRates);
      expect(csv).toContain('Overall');
      expect(csv).toContain('Program');
      expect(csv).toContain('50');
    });
  });
});

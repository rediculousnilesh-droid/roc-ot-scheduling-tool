import { describe, it, expect } from 'vitest';
import { parseShiftCSV, normalizeDateHeader, parseShiftTime, isNonWorkingKeyword } from './shiftParser.js';

describe('shiftParser', () => {
  describe('normalizeDateHeader', () => {
    it('should normalize M/D/YYYY to YYYY-MM-DD', () => {
      expect(normalizeDateHeader('4/15/2026')).toBe('2026-04-15');
      expect(normalizeDateHeader('12/1/2026')).toBe('2026-12-01');
    });

    it('should pass through YYYY-MM-DD', () => {
      expect(normalizeDateHeader('2026-04-15')).toBe('2026-04-15');
    });

    it('should return null for non-date headers', () => {
      expect(normalizeDateHeader('Agent')).toBeNull();
      expect(normalizeDateHeader('Program')).toBeNull();
    });
  });

  describe('isNonWorkingKeyword', () => {
    it('should recognize WO keywords', () => {
      expect(isNonWorkingKeyword('WO')).toBe(true);
      expect(isNonWorkingKeyword('W/O')).toBe(true);
      expect(isNonWorkingKeyword('OFF')).toBe(true);
      expect(isNonWorkingKeyword('LEAVE')).toBe(true);
      expect(isNonWorkingKeyword('HOLIDAY')).toBe(true);
      expect(isNonWorkingKeyword('TRAINING')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isNonWorkingKeyword('wo')).toBe(true);
      expect(isNonWorkingKeyword('Wo')).toBe(true);
    });

    it('should not match shift times', () => {
      expect(isNonWorkingKeyword('07:00-16:00')).toBe(false);
    });
  });

  describe('parseShiftTime', () => {
    it('should parse valid shift times', () => {
      expect(parseShiftTime('07:00-16:00')).toEqual({ start: '07:00', end: '16:00' });
      expect(parseShiftTime('7:00-16:00')).toEqual({ start: '07:00', end: '16:00' });
    });

    it('should return null for WO keywords', () => {
      expect(parseShiftTime('WO')).toBeNull();
      expect(parseShiftTime('LEAVE')).toBeNull();
    });

    it('should return null for empty strings', () => {
      expect(parseShiftTime('')).toBeNull();
    });
  });

  describe('parseShiftCSV', () => {
    it('should parse a valid shift roster CSV', () => {
      const csv = 'Agent,Program,Manager,4/15/2026,4/16/2026\nA1,P1,M1,07:00-16:00,WO\nA2,P1,M1,08:00-17:00,07:00-16:00';
      const { roster, errors } = parseShiftCSV(csv);
      expect(errors).toHaveLength(0);
      expect(roster.agents).toEqual(['A1', 'A2']);
      expect(roster.managers).toEqual(['M1']);
      expect(roster.programs).toEqual(['P1']);
      expect(roster.dates).toEqual(['2026-04-15', '2026-04-16']);
      expect(roster.entries).toHaveLength(4);

      const a1d1 = roster.entries.find((e) => e.agent === 'A1' && e.date === '2026-04-15');
      expect(a1d1?.shiftStart).toBe('07:00');
      expect(a1d1?.shiftEnd).toBe('16:00');
      expect(a1d1?.isWeeklyOff).toBe(false);

      const a1d2 = roster.entries.find((e) => e.agent === 'A1' && e.date === '2026-04-16');
      expect(a1d2?.isWeeklyOff).toBe(true);
    });

    it('should report missing required columns', () => {
      const csv = 'Name,Program\nA1,P1';
      const { errors } = parseShiftCSV(csv);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === 'Agent')).toBe(true);
    });

    it('should handle empty CSV', () => {
      const csv = '';
      const { roster } = parseShiftCSV(csv);
      expect(roster.entries).toHaveLength(0);
    });

    it('should derive unique agents, managers, programs', () => {
      const csv = 'Agent,Program,Manager,4/15/2026\nA1,P1,M1,07:00-16:00\nA2,P2,M2,08:00-17:00\nA1,P1,M1,WO';
      const { roster } = parseShiftCSV(csv);
      expect(roster.agents).toEqual(['A1', 'A2']);
      expect(roster.managers).toEqual(['M1', 'M2']);
      expect(roster.programs).toEqual(['P1', 'P2']);
    });
  });
});

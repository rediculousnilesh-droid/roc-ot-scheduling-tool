import { describe, it, expect } from 'vitest';
import { parseHeatmapCSV, normalizeInterval, isValidHalfHourInterval, validateHeatmapRows, normalizeDate, isPivotFormat, pivotDateToISO, pivotIntervalToTime, convertPivotToStandard } from './heatmapParser.js';

describe('heatmapParser', () => {
  describe('normalizeDate', () => {
    it('should normalize M/D/YYYY to YYYY-MM-DD', () => {
      expect(normalizeDate('4/5/2026')).toBe('2026-04-05');
      expect(normalizeDate('12/25/2026')).toBe('2026-12-25');
    });

    it('should pass through YYYY-MM-DD', () => {
      expect(normalizeDate('2026-04-05')).toBe('2026-04-05');
    });

    it('should return null for invalid dates', () => {
      expect(normalizeDate('invalid')).toBeNull();
    });
  });

  describe('normalizeInterval', () => {
    it('should normalize valid half-hour intervals', () => {
      expect(normalizeInterval('7:00')).toBe('07:00');
      expect(normalizeInterval('07:30')).toBe('07:30');
      expect(normalizeInterval('0:00')).toBe('00:00');
      expect(normalizeInterval('23:30')).toBe('23:30');
    });

    it('should reject non-half-hour intervals', () => {
      expect(normalizeInterval('7:15')).toBeNull();
      expect(normalizeInterval('7:45')).toBeNull();
    });

    it('should handle AM/PM format', () => {
      expect(normalizeInterval('7:00 AM')).toBe('07:00');
      expect(normalizeInterval('1:00 PM')).toBe('13:00');
      expect(normalizeInterval('12:00 PM')).toBe('12:00');
      expect(normalizeInterval('12:00 AM')).toBe('00:00');
    });
  });

  describe('isValidHalfHourInterval', () => {
    it('should return true for valid intervals', () => {
      expect(isValidHalfHourInterval('07:00')).toBe(true);
      expect(isValidHalfHourInterval('07:30')).toBe(true);
    });

    it('should return false for invalid intervals', () => {
      expect(isValidHalfHourInterval('07:15')).toBe(false);
      expect(isValidHalfHourInterval('abc')).toBe(false);
    });
  });

  describe('validateHeatmapRows', () => {
    it('should validate rows with all required columns', () => {
      const rows = [
        { Date: '2026-04-15', Program: 'ProgramA', Interval_Start_Time: '07:00', Over_Under_Value: '-3' },
        { Date: '2026-04-15', Program: 'ProgramA', Interval_Start_Time: '07:30', Over_Under_Value: '2' },
      ];
      const result = validateHeatmapRows(rows);
      expect(result.valid).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.valid[0].overUnderValue).toBe(-3);
    });

    it('should report missing columns', () => {
      const rows = [{ Date: '2026-04-15', Program: 'ProgramA' }];
      const result = validateHeatmapRows(rows as any);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.field === 'Interval_Start_Time')).toBe(true);
    });

    it('should report non-numeric Over_Under_Value', () => {
      const rows = [
        { Date: '2026-04-15', Program: 'P1', Interval_Start_Time: '07:00', Over_Under_Value: 'abc' },
      ];
      const result = validateHeatmapRows(rows);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('Over_Under_Value');
    });

    it('should report invalid interval', () => {
      const rows = [
        { Date: '2026-04-15', Program: 'P1', Interval_Start_Time: '07:15', Over_Under_Value: '-3' },
      ];
      const result = validateHeatmapRows(rows);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('Interval_Start_Time');
    });
  });

  describe('parseHeatmapCSV', () => {
    it('should parse a valid CSV string', () => {
      const csv = 'Date,Program,Interval_Start_Time,Over_Under_Value\n2026-04-15,ProgramA,07:00,-3\n2026-04-15,ProgramA,07:30,2';
      const result = parseHeatmapCSV(csv);
      expect(result.valid).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for invalid CSV', () => {
      const csv = 'Date,Program\n2026-04-15,ProgramA';
      const result = parseHeatmapCSV(csv);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle CSV round-trip', () => {
      const csv = 'Date,Program,Interval_Start_Time,Over_Under_Value\n2026-04-15,P1,07:00,-3\n2026-04-15,P1,07:30,2';
      const result = parseHeatmapCSV(csv);
      expect(result.valid).toHaveLength(2);
      expect(result.valid[0]).toEqual({
        date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '07:00', overUnderValue: -3,
      });
    });
  });

  describe('pivot format detection', () => {
    describe('isPivotFormat', () => {
      it('should detect pivot format with Interval and date columns', () => {
        expect(isPivotFormat(['Program', 'Interval', '31-May', '1-Jun', '2-Jun'])).toBe(true);
      });

      it('should detect pivot format without Program column', () => {
        expect(isPivotFormat(['Interval', '31-May', '1-Jun'])).toBe(true);
      });

      it('should not detect standard format as pivot', () => {
        expect(isPivotFormat(['Date', 'Program', 'Interval_Start_Time', 'Over_Under_Value'])).toBe(false);
      });

      it('should not detect format without Interval column', () => {
        expect(isPivotFormat(['Program', '31-May', '1-Jun'])).toBe(false);
      });

      it('should not detect format with Interval but no date columns', () => {
        expect(isPivotFormat(['Program', 'Interval', 'SomeOtherCol'])).toBe(false);
      });
    });

    describe('pivotDateToISO', () => {
      it('should convert date column headers to ISO format', () => {
        const result = pivotDateToISO('31-May');
        expect(result).toMatch(/^\d{4}-05-31$/);
      });

      it('should handle single-digit days', () => {
        const result = pivotDateToISO('1-Jun');
        expect(result).toMatch(/^\d{4}-06-01$/);
      });

      it('should return null for invalid headers', () => {
        expect(pivotDateToISO('invalid')).toBeNull();
        expect(pivotDateToISO('31-Xyz')).toBeNull();
      });
    });

    describe('pivotIntervalToTime', () => {
      it('should convert 4-digit intervals to HH:MM', () => {
        expect(pivotIntervalToTime('0000')).toBe('00:00');
        expect(pivotIntervalToTime('0030')).toBe('00:30');
        expect(pivotIntervalToTime('1430')).toBe('14:30');
        expect(pivotIntervalToTime('2330')).toBe('23:30');
      });

      it('should reject non-half-hour intervals', () => {
        expect(pivotIntervalToTime('0015')).toBeNull();
        expect(pivotIntervalToTime('0045')).toBeNull();
      });

      it('should reject invalid formats', () => {
        expect(pivotIntervalToTime('abc')).toBeNull();
        expect(pivotIntervalToTime('25:00')).toBeNull();
      });
    });

    describe('convertPivotToStandard', () => {
      it('should convert pivot rows with Program column', () => {
        const headers = ['Program', 'Interval', '31-May', '1-Jun'];
        const rows = [
          { Program: 'SCS', Interval: '0000', '31-May': '-4', '1-Jun': '-7' },
          { Program: 'SCS', Interval: '0030', '31-May': '-4', '1-Jun': '-7' },
        ];
        const result = convertPivotToStandard(headers, rows);
        expect(result).toHaveLength(4);
        expect(result[0].Program).toBe('SCS');
        expect(result[0].Lobby).toBe('');
        expect(result[0].Interval_Start_Time).toBe('00:00');
        expect(result[0].Over_Under_Value).toBe('-4');
      });

      it('should convert pivot rows with Program and Lobby columns', () => {
        const headers = ['Program', 'Lobby', 'Interval', '31-May', '1-Jun'];
        const rows = [
          { Program: 'SCS', Lobby: 'Lobby-A', Interval: '0000', '31-May': '-4', '1-Jun': '-7' },
          { Program: 'SCS', Lobby: 'Lobby-B', Interval: '0000', '31-May': '-2', '1-Jun': '-3' },
        ];
        const result = convertPivotToStandard(headers, rows);
        expect(result).toHaveLength(4);
        expect(result[0].Program).toBe('SCS');
        expect(result[0].Lobby).toBe('Lobby-A');
        expect(result[2].Lobby).toBe('Lobby-B');
      });

      it('should skip empty values', () => {
        const headers = ['Program', 'Interval', '31-May', '1-Jun'];
        const rows = [
          { Program: 'SCS', Interval: '0000', '31-May': '-4', '1-Jun': '' },
        ];
        const result = convertPivotToStandard(headers, rows);
        expect(result).toHaveLength(1);
      });
    });

    describe('parseHeatmapCSV with pivot format', () => {
      it('should auto-detect and parse pivot CSV', () => {
        const csv = 'Program,Interval,31-May,1-Jun\nSCS,0000,-4,-7\nSCS,0030,-4,-7';
        const result = parseHeatmapCSV(csv);
        expect(result.valid).toHaveLength(4);
        expect(result.errors).toHaveLength(0);
        expect(result.valid[0].program).toBe('SCS');
        expect(result.valid[0].lobby).toBe('');
        expect(result.valid[0].intervalStartTime).toBe('00:00');
        expect(result.valid[0].overUnderValue).toBe(-4);
      });

      it('should auto-detect and parse pivot CSV with Lobby column', () => {
        const csv = 'Program,Lobby,Interval,31-May,1-Jun\nSCS,Lobby-A,0000,-4,-7\nSCS,Lobby-B,0000,-2,-3';
        const result = parseHeatmapCSV(csv);
        expect(result.valid).toHaveLength(4);
        expect(result.errors).toHaveLength(0);
        expect(result.valid[0].program).toBe('SCS');
        expect(result.valid[0].lobby).toBe('Lobby-A');
        expect(result.valid[1].lobby).toBe('Lobby-A');
        expect(result.valid[2].lobby).toBe('Lobby-B');
        expect(result.valid[3].lobby).toBe('Lobby-B');
      });

      it('should still parse standard format CSV', () => {
        const csv = 'Date,Program,Interval_Start_Time,Over_Under_Value\n2026-04-15,P1,07:00,-3';
        const result = parseHeatmapCSV(csv);
        expect(result.valid).toHaveLength(1);
        expect(result.errors).toHaveLength(0);
      });

      it('should parse standard format CSV with Lobby column', () => {
        const csv = 'Date,Program,Lobby,Interval_Start_Time,Over_Under_Value\n2026-04-15,SCS,Lobby-A,07:00,-3';
        const result = parseHeatmapCSV(csv);
        expect(result.valid).toHaveLength(1);
        expect(result.errors).toHaveLength(0);
        expect(result.valid[0].lobby).toBe('Lobby-A');
      });

      it('should report errors for pivot rows missing Program', () => {
        const csv = 'Interval,31-May,1-Jun\n0000,-4,-7';
        const result = parseHeatmapCSV(csv);
        // Should still parse but Program will be empty, triggering validation error
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.field === 'Program')).toBe(true);
      });
    });
  });
});

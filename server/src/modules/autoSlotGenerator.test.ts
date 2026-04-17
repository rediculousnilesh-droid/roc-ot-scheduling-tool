import { describe, it, expect } from 'vitest';
import { generateAutoSlots } from './autoSlotGenerator.js';
import type { HeatmapRow, ShiftEntry } from '../types.js';

describe('autoSlotGenerator', () => {
  it('should generate slots for deficit blocks', () => {
    // Create a deficit block: 3 consecutive intervals below -2
    const heatmap: HeatmapRow[] = [
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '05:00', overUnderValue: -5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '05:30', overUnderValue: -5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '06:00', overUnderValue: -5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '06:30', overUnderValue: -5 },
    ];

    const shifts: ShiftEntry[] = [
      { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-15', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false },
    ];

    const result = generateAutoSlots(shifts, heatmap, -2, 'P1');
    expect(result.deficitBlocks.length).toBeGreaterThan(0);
    expect(result.slots.length).toBeGreaterThan(0);
    // Should generate pre-shift OT since deficit is before shift start
    expect(result.slots.some((s) => s.otType.includes('Pre Shift'))).toBe(true);
  });

  it('should generate Full Day OT for WO agents', () => {
    const heatmap: HeatmapRow[] = [
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '10:00', overUnderValue: -5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '10:30', overUnderValue: -5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '11:00', overUnderValue: -5 },
    ];

    const shifts: ShiftEntry[] = [
      { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-15', shiftStart: '', shiftEnd: '', isWeeklyOff: true },
      { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-14', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false },
    ];

    const result = generateAutoSlots(shifts, heatmap, -2, 'P1');
    expect(result.slots.some((s) => s.otType === 'Full Day OT')).toBe(true);
  });

  it('should not generate slots when no deficit blocks exist', () => {
    const heatmap: HeatmapRow[] = [
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '07:00', overUnderValue: 5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '07:30', overUnderValue: 3 },
    ];

    const shifts: ShiftEntry[] = [
      { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-15', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false },
    ];

    const result = generateAutoSlots(shifts, heatmap, -2, 'P1');
    expect(result.deficitBlocks).toHaveLength(0);
    expect(result.slots).toHaveLength(0);
  });

  it('should set all generated slots to Created status with assigned agent', () => {
    const heatmap: HeatmapRow[] = [
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '05:00', overUnderValue: -5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '05:30', overUnderValue: -5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '06:00', overUnderValue: -5 },
    ];

    const shifts: ShiftEntry[] = [
      { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-15', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false },
    ];

    const result = generateAutoSlots(shifts, heatmap, -2, 'P1');
    for (const slot of result.slots) {
      expect(slot.status).toBe('Created');
      expect(slot.assignedAgentId).not.toBeNull();
    }
  });

  it('should generate matching recommendations for each slot', () => {
    const heatmap: HeatmapRow[] = [
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '05:00', overUnderValue: -5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '05:30', overUnderValue: -5 },
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '06:00', overUnderValue: -5 },
    ];

    const shifts: ShiftEntry[] = [
      { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-15', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false },
    ];

    const result = generateAutoSlots(shifts, heatmap, -2, 'P1');
    expect(result.recommendations.length).toBe(result.slots.length);
    for (const rec of result.recommendations) {
      expect(rec.date).toBeTruthy();
      expect(rec.program).toBe('P1');
      expect(rec.agent).toBeTruthy();
      expect(rec.otType).toBeTruthy();
    }
  });

  it('should enforce labor law: max 1 Full Day OT per agent per week with 2+ WOs', () => {
    const heatmap: HeatmapRow[] = [];
    // Create deficit blocks on both WO days
    for (const date of ['2026-04-15', '2026-04-17']) {
      for (let i = 10; i <= 13; i++) {
        heatmap.push({ date, program: 'P1', lobby: '', intervalStartTime: `${String(i).padStart(2, '0')}:00`, overUnderValue: -5 });
        heatmap.push({ date, program: 'P1', lobby: '', intervalStartTime: `${String(i).padStart(2, '0')}:30`, overUnderValue: -5 });
      }
    }

    const shifts: ShiftEntry[] = [
      // Agent has 2 WOs in the same week
      { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-15', shiftStart: '', shiftEnd: '', isWeeklyOff: true },
      { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-17', shiftStart: '', shiftEnd: '', isWeeklyOff: true },
      { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-14', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false },
    ];

    const result = generateAutoSlots(shifts, heatmap, -2, 'P1');
    const fullDaySlots = result.slots.filter((s) => s.otType === 'Full Day OT' && s.assignedAgentId === 'A1');
    expect(fullDaySlots.length).toBeLessThanOrEqual(1);
  });
});

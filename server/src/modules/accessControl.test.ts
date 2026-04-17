import { describe, it, expect } from 'vitest';
import { validateAgentPickup, getEligibleSlotsForAgent, getManagerPrograms } from './accessControl.js';
import type { OTSlot, ShiftRoster } from '../types.js';
import { createSlot, createSlotForAgent } from './slotManager.js';

// Use dates far in the future so the 30-minute cutoff doesn't interfere
const makeRoster = (): ShiftRoster => ({
  entries: [
    { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2027-06-15', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false },
    { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2027-06-16', shiftStart: '', shiftEnd: '', isWeeklyOff: true },
    { agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2027-06-17', shiftStart: '', shiftEnd: '', isWeeklyOff: true },
    { agent: 'A2', program: 'P2', lobby: '', manager: 'M2', date: '2027-06-15', shiftStart: '08:00', shiftEnd: '17:00', isWeeklyOff: false },
  ],
  agents: ['A1', 'A2'],
  managers: ['M1', 'M2'],
  programs: ['P1', 'P2'],
  lobbies: [],
  dates: ['2027-06-15', '2027-06-16', '2027-06-17'],
});

describe('accessControl', () => {
  describe('validateAgentPickup', () => {
    it('should allow valid pickup', () => {
      const slot: OTSlot = { ...createSlotForAgent({ otType: '1hr Pre Shift OT', date: '2027-06-15', program: 'P1', timeWindow: '06:00-07:00' }, 'A1', 'A1'), status: 'Released' };
      const result = validateAgentPickup([slot], slot.id, 'A1', makeRoster());
      expect(result.valid).toBe(true);
    });

    it('should reject non-Released slot', () => {
      const slot = createSlotForAgent({ otType: '1hr Pre Shift OT', date: '2027-06-15', program: 'P1', timeWindow: '06:00-07:00' }, 'A1', 'A1');
      const result = validateAgentPickup([slot], slot.id, 'A1', makeRoster());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no longer available');
    });

    it('should reject program mismatch', () => {
      const slot: OTSlot = { ...createSlotForAgent({ otType: '1hr Pre Shift OT', date: '2027-06-15', program: 'P2', timeWindow: '06:00-07:00' }, 'A2', 'A2'), status: 'Released' };
      const result = validateAgentPickup([slot], slot.id, 'A1', makeRoster());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('program mismatch');
    });

    it('should reject Full Day OT for non-WO agent', () => {
      const slot: OTSlot = { ...createSlotForAgent({ otType: 'Full Day OT', date: '2027-06-15', program: 'P1', timeWindow: '07:00-16:00' }, 'A1', 'A1'), status: 'Released' };
      const result = validateAgentPickup([slot], slot.id, 'A1', makeRoster());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('weekly off');
    });

    it('should allow Full Day OT for WO agent', () => {
      const slot: OTSlot = { ...createSlotForAgent({ otType: 'Full Day OT', date: '2027-06-16', program: 'P1', timeWindow: '07:00-16:00' }, 'A1', 'A1'), status: 'Released' };
      const result = validateAgentPickup([slot], slot.id, 'A1', makeRoster());
      expect(result.valid).toBe(true);
    });

    it('should enforce max 1 Full Day OT per week with 2+ WOs', () => {
      const slot1: OTSlot = {
        ...createSlotForAgent({ otType: 'Full Day OT', date: '2027-06-16', program: 'P1', timeWindow: '07:00-16:00' }, 'A1', 'A1'),
        status: 'Filled', filledByAgentId: 'A1', filledByAgentName: 'A1',
      };
      const slot2: OTSlot = { ...createSlotForAgent({ otType: 'Full Day OT', date: '2027-06-17', program: 'P1', timeWindow: '07:00-16:00' }, 'A1', 'A1'), status: 'Released' };
      const result = validateAgentPickup([slot1, slot2], slot2.id, 'A1', makeRoster());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('maximum Full Day OT');
    });

    it('should enforce max 1 Pre/Post OT per day', () => {
      const slot1: OTSlot = {
        ...createSlotForAgent({ otType: '1hr Pre Shift OT', date: '2027-06-15', program: 'P1', timeWindow: '06:00-07:00' }, 'A1', 'A1'),
        status: 'Filled', filledByAgentId: 'A1', filledByAgentName: 'A1',
      };
      const slot2: OTSlot = { ...createSlotForAgent({ otType: '1hr Post Shift OT', date: '2027-06-15', program: 'P1', timeWindow: '16:00-17:00' }, 'A1', 'A1'), status: 'Released' };
      const result = validateAgentPickup([slot1, slot2], slot2.id, 'A1', makeRoster());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Pre/Post Shift OT pickup on this date');
    });

    it('should reject pickup within 30 minutes of start time', () => {
      // Use a date/time that's in the past to trigger the cutoff
      const slot: OTSlot = { ...createSlotForAgent({ otType: '1hr Pre Shift OT', date: '2020-01-01', program: 'P1', timeWindow: '06:00-07:00' }, 'A1', 'A1'), status: 'Released' };
      const pastRoster: ShiftRoster = {
        ...makeRoster(),
        entries: [{ agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2020-01-01', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false }],
      };
      const result = validateAgentPickup([slot], slot.id, 'A1', pastRoster);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('less than 30 minutes');
    });
  });

  describe('getEligibleSlotsForAgent', () => {
    it('should return only eligible slots', () => {
      const slot1: OTSlot = { ...createSlotForAgent({ otType: '1hr Pre Shift OT', date: '2027-06-15', program: 'P1', timeWindow: '06:00-07:00' }, 'A1', 'A1'), status: 'Released' };
      const slot2: OTSlot = { ...createSlotForAgent({ otType: '1hr Pre Shift OT', date: '2027-06-15', program: 'P2', timeWindow: '07:00-08:00' }, 'A2', 'A2'), status: 'Released' };
      const slot3: OTSlot = { ...createSlotForAgent({ otType: '1hr Pre Shift OT', date: '2027-06-15', program: 'P1', timeWindow: '06:00-07:00' }, 'A1', 'A1'), status: 'Created' };

      const eligible = getEligibleSlotsForAgent([slot1, slot2, slot3], 'A1', makeRoster());
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe(slot1.id);
    });

    it('should filter out slots within 30 minutes of start time', () => {
      const slot: OTSlot = { ...createSlotForAgent({ otType: '1hr Pre Shift OT', date: '2020-01-01', program: 'P1', timeWindow: '06:00-07:00' }, 'A1', 'A1'), status: 'Released' };
      const pastRoster: ShiftRoster = {
        ...makeRoster(),
        entries: [{ agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2020-01-01', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false }],
      };
      const eligible = getEligibleSlotsForAgent([slot], 'A1', pastRoster);
      expect(eligible).toHaveLength(0);
    });
  });

  describe('getManagerPrograms', () => {
    it('should return programs for a manager', () => {
      const programs = getManagerPrograms('M1', makeRoster());
      expect(programs).toEqual(['P1']);
    });

    it('should return empty for unknown manager', () => {
      const programs = getManagerPrograms('Unknown', makeRoster());
      expect(programs).toEqual([]);
    });
  });
});

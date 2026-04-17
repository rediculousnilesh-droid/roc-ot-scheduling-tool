import { describe, it, expect } from 'vitest';
import { createSlot, createSlotForAgent, releaseSlots, cancelSlot, pickupSlot, returnSlot, getSlotsByStatus, getSlotsByProgram } from './slotManager.js';
import type { OTSlot, CreateSlotParams } from '../types.js';

const baseParams: CreateSlotParams = {
  otType: '1hr Pre Shift OT',
  date: '2026-04-15',
  program: 'P1',
  timeWindow: '06:00-07:00',
};

describe('slotManager', () => {
  describe('createSlot', () => {
    it('should create a slot with Created status', () => {
      const slot = createSlot(baseParams);
      expect(slot.status).toBe('Created');
      expect(slot.otType).toBe('1hr Pre Shift OT');
      expect(slot.assignedAgentId).toBeNull();
      expect(slot.filledByAgentId).toBeNull();
      expect(slot.returnedAt).toBeNull();
    });
  });

  describe('createSlotForAgent', () => {
    it('should create a slot pre-assigned to an agent', () => {
      const slot = createSlotForAgent(baseParams, 'A1', 'Agent One');
      expect(slot.status).toBe('Created');
      expect(slot.assignedAgentId).toBe('A1');
      expect(slot.assignedAgentName).toBe('Agent One');
    });
  });

  describe('releaseSlots', () => {
    it('should release Created slots', () => {
      const slot = createSlot(baseParams);
      const result = releaseSlots([slot], [slot.id]);
      expect(result[0].status).toBe('Released');
      expect(result[0].releasedAt).not.toBeNull();
    });

    it('should throw for non-Created slots', () => {
      const slot = { ...createSlot(baseParams), status: 'Released' as const };
      expect(() => releaseSlots([slot], [slot.id])).toThrow();
    });
  });

  describe('cancelSlot', () => {
    it('should cancel Created slots', () => {
      const slot = createSlot(baseParams);
      const result = cancelSlot([slot], slot.id);
      expect(result[0].status).toBe('Cancelled');
    });

    it('should cancel Released slots', () => {
      const slot = { ...createSlot(baseParams), status: 'Released' as const };
      const result = cancelSlot([slot], slot.id);
      expect(result[0].status).toBe('Cancelled');
    });

    it('should throw for Filled slots', () => {
      const slot = { ...createSlot(baseParams), status: 'Filled' as const };
      expect(() => cancelSlot([slot], slot.id)).toThrow();
    });
  });

  describe('pickupSlot', () => {
    it('should fill a Released slot', () => {
      const slot = { ...createSlot(baseParams), status: 'Released' as const };
      const result = pickupSlot([slot], slot.id, 'A1', 'Agent One');
      expect(result[0].status).toBe('Filled');
      expect(result[0].filledByAgentId).toBe('A1');
      expect(result[0].filledByAgentName).toBe('Agent One');
      expect(result[0].filledAt).not.toBeNull();
    });

    it('should throw for non-Released slots', () => {
      const slot = createSlot(baseParams);
      expect(() => pickupSlot([slot], slot.id, 'A1', 'Agent One')).toThrow('no longer available');
    });
  });

  describe('returnSlot', () => {
    it('should return a Filled slot to Released', () => {
      const slot: OTSlot = {
        ...createSlot(baseParams),
        status: 'Filled',
        filledByAgentId: 'A1',
        filledByAgentName: 'Agent One',
        filledAt: new Date().toISOString(),
      };
      const result = returnSlot([slot], slot.id);
      expect(result[0].status).toBe('Released');
      expect(result[0].filledByAgentId).toBeNull();
      expect(result[0].filledByAgentName).toBeNull();
      expect(result[0].returnedAt).not.toBeNull();
    });

    it('should throw for non-Filled slots', () => {
      const slot = createSlot(baseParams);
      expect(() => returnSlot([slot], slot.id)).toThrow('cannot be returned');
    });
  });

  describe('getSlotsByStatus', () => {
    it('should filter by status', () => {
      const s1 = createSlot(baseParams);
      const s2 = { ...createSlot(baseParams), status: 'Released' as const };
      expect(getSlotsByStatus([s1, s2], 'Created')).toHaveLength(1);
      expect(getSlotsByStatus([s1, s2], 'Released')).toHaveLength(1);
    });
  });

  describe('getSlotsByProgram', () => {
    it('should filter by program', () => {
      const s1 = createSlot(baseParams);
      const s2 = createSlot({ ...baseParams, program: 'P2' });
      expect(getSlotsByProgram([s1, s2], 'P1')).toHaveLength(1);
      expect(getSlotsByProgram([s1, s2], 'P2')).toHaveLength(1);
    });
  });
});

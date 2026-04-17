import type { OTSlot, CreateSlotParams, SlotStatus } from '../types.js';
import { v4 as uuidv4 } from 'uuid';

function generateId(): string {
  return `slot_${uuidv4()}`;
}

/**
 * Creates a new OT slot with status "Created".
 */
export function createSlot(params: CreateSlotParams): OTSlot {
  return {
    id: generateId(),
    otType: params.otType,
    date: params.date,
    program: params.program,
    lobby: params.lobby ?? '',
    timeWindow: params.timeWindow,
    status: 'Created',
    assignedAgentId: null,
    assignedAgentName: null,
    createdAt: new Date().toISOString(),
    releasedAt: null,
    filledAt: null,
    filledByAgentId: null,
    filledByAgentName: null,
    returnedAt: null,
  };
}

/**
 * Creates a slot pre-assigned to a specific agent (for auto-generation).
 */
export function createSlotForAgent(
  params: CreateSlotParams,
  agentId: string,
  agentName: string,
): OTSlot {
  return {
    ...createSlot(params),
    assignedAgentId: agentId,
    assignedAgentName: agentName,
  };
}

/**
 * Releases one or more slots. Each must be in "Created" status.
 */
export function releaseSlots(slots: OTSlot[], slotIds: string[]): OTSlot[] {
  const idSet = new Set(slotIds);
  return slots.map((slot) => {
    if (!idSet.has(slot.id)) return slot;
    if (slot.status !== 'Created') {
      throw new Error(`Slot cannot be released from "${slot.status}" status.`);
    }
    return { ...slot, status: 'Released' as SlotStatus, releasedAt: new Date().toISOString() };
  });
}

/**
 * Cancels a slot. Must be in "Created" or "Released" status.
 */
export function cancelSlot(slots: OTSlot[], slotId: string): OTSlot[] {
  return slots.map((slot) => {
    if (slot.id !== slotId) return slot;
    if (slot.status !== 'Created' && slot.status !== 'Released') {
      throw new Error(`Slot cannot be cancelled from "${slot.status}" status.`);
    }
    return { ...slot, status: 'Cancelled' as SlotStatus };
  });
}

/**
 * Picks up a released slot for an agent.
 */
export function pickupSlot(
  slots: OTSlot[],
  slotId: string,
  agentId: string,
  agentName: string,
): OTSlot[] {
  return slots.map((slot) => {
    if (slot.id !== slotId) return slot;
    if (slot.status !== 'Released') {
      throw new Error('This slot is no longer available.');
    }
    return {
      ...slot,
      status: 'Filled' as SlotStatus,
      filledAt: new Date().toISOString(),
      filledByAgentId: agentId,
      filledByAgentName: agentName,
    };
  });
}

/**
 * Returns a filled slot back to Released status.
 */
export function returnSlot(slots: OTSlot[], slotId: string): OTSlot[] {
  return slots.map((slot) => {
    if (slot.id !== slotId) return slot;
    if (slot.status !== 'Filled') {
      throw new Error('This slot cannot be returned from its current status.');
    }
    return {
      ...slot,
      status: 'Released' as SlotStatus,
      filledAt: null,
      filledByAgentId: null,
      filledByAgentName: null,
      returnedAt: new Date().toISOString(),
    };
  });
}

/**
 * Returns slots filtered by status.
 */
export function getSlotsByStatus(slots: OTSlot[], status: SlotStatus): OTSlot[] {
  return slots.filter((s) => s.status === status);
}

/**
 * Returns slots filtered by program.
 */
export function getSlotsByProgram(slots: OTSlot[], program: string): OTSlot[] {
  return slots.filter((s) => s.program === program);
}

import type { OTSlot, ShiftRoster, ShiftEntry } from '../types.js';

/**
 * Returns the ISO week string for a date, e.g. "2025-W15".
 */
function getWeek(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00Z');
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Validates whether an agent can pick up a specific slot.
 */
export function validateAgentPickup(
  slots: OTSlot[],
  slotId: string,
  agentId: string,
  roster: ShiftRoster,
): { valid: boolean; error?: string } {
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return { valid: false, error: 'Slot not found.' };

  if (slot.status !== 'Released') {
    return { valid: false, error: 'This slot is no longer available.' };
  }

  // 30-minute cutoff: agent cannot pick up a slot if it starts within 30 minutes
  const slotStartTime = slot.timeWindow.split('-')[0]?.trim();
  if (slotStartTime) {
    const now = new Date();
    const slotDateTime = new Date(`${slot.date}T${slotStartTime}:00`);
    const diffMs = slotDateTime.getTime() - now.getTime();
    const diffMinutes = diffMs / (1000 * 60);
    if (diffMinutes < 30) {
      return { valid: false, error: 'This slot can no longer be picked up (less than 30 minutes to start time).' };
    }
  }

  // Find agent's entries
  const agentEntries = roster.entries.filter((e) => e.agent === agentId);
  if (agentEntries.length === 0) {
    return { valid: false, error: 'Agent not found in roster.' };
  }

  // Check program match
  const agentPrograms = [...new Set(agentEntries.map((e) => e.program))];
  if (!agentPrograms.includes(slot.program)) {
    return { valid: false, error: 'You are not eligible for this slot (program mismatch).' };
  }

  // Check lobby match — agent can only pick up slots from their lobby
  if (slot.lobby) {
    const agentLobbies = [...new Set(agentEntries.filter((e) => e.lobby).map((e) => e.lobby))];
    if (agentLobbies.length > 0 && !agentLobbies.includes(slot.lobby)) {
      return { valid: false, error: 'You are not eligible for this slot (lobby mismatch).' };
    }
  }

  const isFullDay = slot.otType === 'Full Day OT';

  if (isFullDay) {
    // Agent must have weekly off on that date
    const dateEntry = agentEntries.find((e) => e.date === slot.date);
    if (!dateEntry || !dateEntry.isWeeklyOff) {
      return { valid: false, error: 'Full Day OT is only available for agents with a weekly off on this date.' };
    }

    // Max 1 Full Day OT per week when agent has 2+ weekly offs
    const slotWeek = getWeek(slot.date);
    const agentWODates = agentEntries.filter((e) => e.isWeeklyOff).map((e) => e.date);
    const woInWeek = agentWODates.filter((d) => getWeek(d) === slotWeek).length;

    if (woInWeek >= 2) {
      const filledFullDayThisWeek = slots.filter(
        (s) => s.status === 'Filled' &&
          s.filledByAgentId === agentId &&
          s.otType === 'Full Day OT' &&
          getWeek(s.date) === slotWeek
      );
      if (filledFullDayThisWeek.length >= 1) {
        return { valid: false, error: 'You have reached the maximum Full Day OT pickups for this week.' };
      }
    }
  } else {
    // Pre/Post OT: slot's assigned agent must match requesting agent
    if (slot.assignedAgentId && slot.assignedAgentId !== agentId) {
      return { valid: false, error: 'This slot is assigned to a different agent.' };
    }

    // Max 1 Pre/Post OT per agent per day
    const filledPrePostToday = slots.filter(
      (s) => s.status === 'Filled' &&
        s.filledByAgentId === agentId &&
        s.date === slot.date &&
        s.otType !== 'Full Day OT'
    );
    if (filledPrePostToday.length >= 1) {
      return { valid: false, error: 'You already have a Pre/Post Shift OT pickup on this date.' };
    }
  }

  return { valid: true };
}

/**
 * Returns eligible slots for an agent.
 */
export function getEligibleSlotsForAgent(
  slots: OTSlot[],
  agentId: string,
  roster: ShiftRoster,
): OTSlot[] {
  const agentEntries = roster.entries.filter((e) => e.agent === agentId);
  if (agentEntries.length === 0) return [];

  const agentPrograms = new Set(agentEntries.map((e) => e.program));
  const agentLobbies = new Set(agentEntries.filter((e) => e.lobby).map((e) => e.lobby));
  const releasedSlots = slots.filter((s) => s.status === 'Released');

  return releasedSlots.filter((slot) => {
    // Must match program
    if (!agentPrograms.has(slot.program)) return false;

    // Must match lobby (if slot has a lobby and agent has lobbies)
    if (slot.lobby && agentLobbies.size > 0 && !agentLobbies.has(slot.lobby)) return false;

    // 30-minute cutoff: hide slots that start within 30 minutes
    const slotStartTime = slot.timeWindow.split('-')[0]?.trim();
    if (slotStartTime) {
      const now = new Date();
      const slotDateTime = new Date(`${slot.date}T${slotStartTime}:00`);
      const diffMs = slotDateTime.getTime() - now.getTime();
      if (diffMs < 30 * 60 * 1000) return false;
    }

    if (slot.otType === 'Full Day OT') {
      // Agent must have weekly off on that date
      const dateEntry = agentEntries.find((e) => e.date === slot.date);
      return dateEntry?.isWeeklyOff === true;
    } else {
      // Pre/Post OT: assigned agent must match
      if (slot.assignedAgentId && slot.assignedAgentId !== agentId) return false;
      return true;
    }
  });
}

/**
 * Returns programs managed by a given manager.
 */
export function getManagerPrograms(managerName: string, roster: ShiftRoster): string[] {
  const programs = new Set<string>();
  for (const entry of roster.entries) {
    if (entry.manager === managerName) {
      programs.add(entry.program);
    }
  }
  return [...programs];
}

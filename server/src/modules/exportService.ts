import type { OTSlot, ShiftRoster, AllFillRates } from '../types.js';
import { getWeek } from './fillRateCalculator.js';

function escapeCSVField(field: string): string {
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializes slots to CSV string.
 */
export function serializeSlotsToCSV(slots: OTSlot[], roster: ShiftRoster): string {
  // Build agent → manager mapping from roster
  const agentToManager = new Map<string, string>();
  const programToManager = new Map<string, string>();
  for (const entry of roster.entries) {
    if (!agentToManager.has(entry.agent)) {
      agentToManager.set(entry.agent, entry.manager);
    }
    if (!programToManager.has(entry.program)) {
      programToManager.set(entry.program, entry.manager);
    }
  }

  const headers = ['Date', 'Week', 'Program', 'OT_Type', 'Time_Window', 'Slot_Status', 'Assigned_Agent', 'Manager'];

  const rows = slots.map((slot) => {
    const week = getWeek(slot.date);
    const assignedAgent = slot.filledByAgentName ?? slot.assignedAgentName ?? '';
    let manager = '';
    if (slot.filledByAgentId) {
      manager = agentToManager.get(slot.filledByAgentId) ?? '';
    }
    if (!manager && slot.assignedAgentId) {
      manager = agentToManager.get(slot.assignedAgentId) ?? '';
    }
    if (!manager) {
      manager = programToManager.get(slot.program) ?? '';
    }

    return [slot.date, week, slot.program, slot.otType, slot.timeWindow, slot.status, assignedAgent, manager]
      .map(escapeCSVField)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Serializes fill rates to CSV string.
 */
export function serializeFillRatesToCSV(fillRates: AllFillRates): string {
  const headers = ['Grouping', 'Key', 'Total_Released', 'Total_Filled', 'Fill_Rate'];
  const rows: string[] = [];

  // Overall
  const o = fillRates.overall;
  rows.push(['Overall', 'All', String(o.totalReleased), String(o.totalFilled), o.fillRate !== null ? String(o.fillRate) : 'N/A'].map(escapeCSVField).join(','));

  // By Program
  for (const [key, val] of Object.entries(fillRates.byProgram)) {
    rows.push(['Program', key, String(val.totalReleased), String(val.totalFilled), val.fillRate !== null ? String(val.fillRate) : 'N/A'].map(escapeCSVField).join(','));
  }

  // By Manager
  for (const [key, val] of Object.entries(fillRates.byManager)) {
    rows.push(['Manager', key, String(val.totalReleased), String(val.totalFilled), val.fillRate !== null ? String(val.fillRate) : 'N/A'].map(escapeCSVField).join(','));
  }

  // By Date
  for (const [key, val] of Object.entries(fillRates.byDate)) {
    rows.push(['Date', key, String(val.totalReleased), String(val.totalFilled), val.fillRate !== null ? String(val.fillRate) : 'N/A'].map(escapeCSVField).join(','));
  }

  // By Week
  for (const [key, val] of Object.entries(fillRates.byWeek)) {
    rows.push(['Week', key, String(val.totalReleased), String(val.totalFilled), val.fillRate !== null ? String(val.fillRate) : 'N/A'].map(escapeCSVField).join(','));
  }

  return [headers.join(','), ...rows].join('\n');
}

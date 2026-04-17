import type { OTSlot, ShiftRoster, FillRateResult, AllFillRates, WeekKey } from '../types.js';

/**
 * Returns the ISO week string for a date, e.g. "2025-W15".
 */
export function getWeek(dateStr: string): WeekKey {
  const date = new Date(dateStr + 'T12:00:00Z');
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function isRelevant(slot: OTSlot): boolean {
  return slot.status === 'Released' || slot.status === 'Filled';
}

function computeRate(released: number, filled: number): FillRateResult {
  return {
    totalReleased: released,
    totalFilled: filled,
    fillRate: released === 0 ? null : Math.round((filled / released) * 10000) / 100,
  };
}

export function calculateOverallFillRate(slots: OTSlot[]): FillRateResult {
  const relevant = slots.filter(isRelevant);
  const filled = relevant.filter((s) => s.status === 'Filled').length;
  return computeRate(relevant.length, filled);
}

export function calculateFillRateByProgram(slots: OTSlot[]): Map<string, FillRateResult> {
  const groups = new Map<string, OTSlot[]>();
  for (const slot of slots.filter(isRelevant)) {
    const arr = groups.get(slot.program) ?? [];
    arr.push(slot);
    groups.set(slot.program, arr);
  }
  const result = new Map<string, FillRateResult>();
  for (const [program, groupSlots] of groups) {
    const filled = groupSlots.filter((s) => s.status === 'Filled').length;
    result.set(program, computeRate(groupSlots.length, filled));
  }
  return result;
}

export function calculateFillRateByManager(
  slots: OTSlot[],
  roster: ShiftRoster,
): Map<string, FillRateResult> {
  // Build program → managers mapping from roster
  const programToManagers = new Map<string, Set<string>>();
  for (const entry of roster.entries) {
    const managers = programToManagers.get(entry.program) ?? new Set();
    managers.add(entry.manager);
    programToManagers.set(entry.program, managers);
  }

  const groups = new Map<string, { released: number; filled: number }>();
  for (const slot of slots.filter(isRelevant)) {
    const managers = programToManagers.get(slot.program);
    if (managers) {
      for (const manager of managers) {
        const entry = groups.get(manager) ?? { released: 0, filled: 0 };
        entry.released += 1;
        if (slot.status === 'Filled') entry.filled += 1;
        groups.set(manager, entry);
      }
    }
  }

  const result = new Map<string, FillRateResult>();
  for (const [manager, { released, filled }] of groups) {
    result.set(manager, computeRate(released, filled));
  }
  return result;
}

export function calculateFillRateByDate(slots: OTSlot[]): Map<string, FillRateResult> {
  const groups = new Map<string, OTSlot[]>();
  for (const slot of slots.filter(isRelevant)) {
    const arr = groups.get(slot.date) ?? [];
    arr.push(slot);
    groups.set(slot.date, arr);
  }
  const result = new Map<string, FillRateResult>();
  for (const [date, groupSlots] of groups) {
    const filled = groupSlots.filter((s) => s.status === 'Filled').length;
    result.set(date, computeRate(groupSlots.length, filled));
  }
  return result;
}

export function calculateFillRateByWeek(slots: OTSlot[]): Map<string, FillRateResult> {
  const groups = new Map<string, OTSlot[]>();
  for (const slot of slots.filter(isRelevant)) {
    const week = getWeek(slot.date);
    const arr = groups.get(week) ?? [];
    arr.push(slot);
    groups.set(week, arr);
  }
  const result = new Map<string, FillRateResult>();
  for (const [week, groupSlots] of groups) {
    const filled = groupSlots.filter((s) => s.status === 'Filled').length;
    result.set(week, computeRate(groupSlots.length, filled));
  }
  return result;
}

export function calculateFillRateByProgramWeek(
  slots: OTSlot[],
): Map<string, Map<string, FillRateResult>> {
  const groups = new Map<string, Map<string, OTSlot[]>>();
  for (const slot of slots.filter(isRelevant)) {
    const week = getWeek(slot.date);
    if (!groups.has(slot.program)) groups.set(slot.program, new Map());
    const weekMap = groups.get(slot.program)!;
    const arr = weekMap.get(week) ?? [];
    arr.push(slot);
    weekMap.set(week, arr);
  }
  const result = new Map<string, Map<string, FillRateResult>>();
  for (const [program, weekMap] of groups) {
    const inner = new Map<string, FillRateResult>();
    for (const [week, groupSlots] of weekMap) {
      const filled = groupSlots.filter((s) => s.status === 'Filled').length;
      inner.set(week, computeRate(groupSlots.length, filled));
    }
    result.set(program, inner);
  }
  return result;
}

export function calculateFillRateByManagerWeek(
  slots: OTSlot[],
  roster: ShiftRoster,
): Map<string, Map<string, FillRateResult>> {
  const programToManagers = new Map<string, Set<string>>();
  for (const entry of roster.entries) {
    const managers = programToManagers.get(entry.program) ?? new Set();
    managers.add(entry.manager);
    programToManagers.set(entry.program, managers);
  }

  const groups = new Map<string, Map<string, { released: number; filled: number }>>();
  for (const slot of slots.filter(isRelevant)) {
    const week = getWeek(slot.date);
    const managers = programToManagers.get(slot.program);
    if (managers) {
      for (const manager of managers) {
        if (!groups.has(manager)) groups.set(manager, new Map());
        const weekMap = groups.get(manager)!;
        const entry = weekMap.get(week) ?? { released: 0, filled: 0 };
        entry.released += 1;
        if (slot.status === 'Filled') entry.filled += 1;
        weekMap.set(week, entry);
      }
    }
  }

  const result = new Map<string, Map<string, FillRateResult>>();
  for (const [manager, weekMap] of groups) {
    const inner = new Map<string, FillRateResult>();
    for (const [week, { released, filled }] of weekMap) {
      inner.set(week, computeRate(released, filled));
    }
    result.set(manager, inner);
  }
  return result;
}

function mapToRecord<V>(map: Map<string, V>): Record<string, V> {
  const obj: Record<string, V> = {};
  for (const [k, v] of map) obj[k] = v;
  return obj;
}

function nestedMapToRecord(map: Map<string, Map<string, FillRateResult>>): Record<string, Record<string, FillRateResult>> {
  const obj: Record<string, Record<string, FillRateResult>> = {};
  for (const [k, v] of map) obj[k] = mapToRecord(v);
  return obj;
}

export function calculateAllFillRates(slots: OTSlot[], roster: ShiftRoster): AllFillRates {
  return {
    overall: calculateOverallFillRate(slots),
    byProgram: mapToRecord(calculateFillRateByProgram(slots)),
    byManager: mapToRecord(calculateFillRateByManager(slots, roster)),
    byDate: mapToRecord(calculateFillRateByDate(slots)),
    byWeek: mapToRecord(calculateFillRateByWeek(slots)),
    byProgramWeek: nestedMapToRecord(calculateFillRateByProgramWeek(slots)),
    byManagerWeek: nestedMapToRecord(calculateFillRateByManagerWeek(slots, roster)),
  };
}

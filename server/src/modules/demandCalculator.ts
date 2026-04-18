import type {
  HeatmapRow,
  ShiftEntry,
  OTRecommendation,
  DemandWindow,
  DemandInput,
  DemandResult,
  DeficitBlock,
  OTType,
} from '../types.js';

// ── Interval helpers (same logic as autoSlotGenerator) ──

const ALL_INTERVALS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

function intervalIndex(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 2 + (m >= 30 ? 1 : 0);
}

function indexToTime(idx: number): string {
  let i = idx;
  if (i >= 48) i -= 48;
  if (i < 0) i += 48;
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
}

// ── Types for internal use ──

/** Key: "shiftStart-shiftEnd|date|program|lobby" */
type BudgetKey = string;

interface CandidateWindow {
  date: string;
  program: string;
  lobby: string;
  startIdx: number;
  endIdx: number;
  shiftStart: string;
  shiftEnd: string;
  agent: string;
  manager: string;
  shiftStr: string;
  otType: OTType;
  slotKey: string;
}

// ── Main export ──

export function computeDemand(input: DemandInput): DemandResult {
  const { heatmapData, shifts, program, tolerance } = input;

  // 1. Validate tolerance
  const tol = tolerance ?? -2;
  if (typeof tol !== 'number' || Number.isNaN(tol)) {
    throw new Error('Tolerance must be a numeric value.');
  }
  if (tol < -2 || tol > -1) {
    throw new Error(
      `Tolerance must be between -2 and -1 inclusive. Received: ${tol}`,
    );
  }

  // Edge case: empty inputs
  if (heatmapData.length === 0 || shifts.length === 0) {
    return emptyResult(heatmapData);
  }

  // 2. Build interval map: date|program|lobby → intervalStartTime → overUnderValue
  const intervalMap = buildIntervalMap(heatmapData, program);

  // 3. Identify candidate OT windows
  const candidates = identifyCandidateWindows(shifts, program, intervalMap);

  if (candidates.length === 0) {
    return emptyResult(heatmapData);
  }

  // Sort candidates chronologically (by date, then startIdx) for deterministic budget allocation
  candidates.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.startIdx - b.startIdx;
  });

  // 4-6. Compute average deficit, apply tolerance threshold, enforce budget
  const toleranceBudget = new Map<BudgetKey, number>();
  const qualifiedWindows: Array<DemandWindow & { agent: string; manager: string; shiftStr: string; otType: OTType }> = [];
  const usedSlotKeys = new Set<string>();

  for (const candidate of candidates) {
    // Deduplication
    if (usedSlotKeys.has(candidate.slotKey)) continue;

    const mapKey = `${candidate.date}|${candidate.program}|${candidate.lobby}`;
    const intervals = intervalMap.get(mapKey);
    if (!intervals) continue;

    // 4. Compute average deficit for this window
    let sum = 0;
    let count = 0;
    for (let i = candidate.startIdx; i < candidate.endIdx; i++) {
      const actualIdx = i % 48;
      const time = ALL_INTERVALS[actualIdx];
      const val = intervals.get(time);
      if (val !== undefined) {
        sum += val;
        count++;
      }
    }

    if (count === 0) continue;
    const averageDeficit = sum / count;

    // 6. Enforce tolerance budget
    const budgetKey: BudgetKey = `${candidate.shiftStart}-${candidate.shiftEnd}|${candidate.date}|${candidate.program}|${candidate.lobby}`;
    const usedBudget = toleranceBudget.get(budgetKey) ?? 0;
    const effectiveTolerance = usedBudget >= 2 ? 0 : tol;

    // 5. Apply tolerance threshold
    if (averageDeficit >= effectiveTolerance) continue;

    const effectiveDemand = Math.ceil(Math.abs(averageDeficit - effectiveTolerance));

    // Track tolerance budget usage: count intervals in this window that use tolerance
    const toleranceIntervalsUsed = effectiveTolerance !== 0 ? Math.min(count, 2 - usedBudget) : 0;
    toleranceBudget.set(budgetKey, usedBudget + toleranceIntervalsUsed);

    usedSlotKeys.add(candidate.slotKey);

    qualifiedWindows.push({
      date: candidate.date,
      program: candidate.program,
      lobby: candidate.lobby,
      startInterval: indexToTime(candidate.startIdx),
      endInterval: indexToTime(candidate.endIdx),
      startIdx: candidate.startIdx,
      endIdx: candidate.endIdx,
      averageDeficit,
      effectiveDemand,
      toleranceIntervalsUsed,
      shiftStart: candidate.shiftStart,
      shiftEnd: candidate.shiftEnd,
      agent: candidate.agent,
      manager: candidate.manager,
      shiftStr: candidate.shiftStr,
      otType: candidate.otType,
    });
  }

  if (qualifiedWindows.length === 0) {
    return emptyResult(heatmapData);
  }

  // 7. Generate OTRecommendation records
  const recommendations: OTRecommendation[] = [];
  const demandWindows: DemandWindow[] = [];
  const summary = { total: 0, oneHrPre: 0, oneHrPost: 0, twoHrPre: 0, twoHrPost: 0, fullDay: 0 };

  for (const w of qualifiedWindows) {
    const otTimeWindow = `${w.startInterval}-${w.endInterval}`;
    const deficitBlock = `${w.startInterval}-${w.endInterval}`;

    recommendations.push({
      date: w.date,
      program: w.program,
      lobby: w.lobby,
      agent: w.agent,
      manager: w.manager,
      shift: w.shiftStr,
      otType: w.otType,
      otTimeWindow,
      deficitBlock,
    });

    demandWindows.push({
      date: w.date,
      program: w.program,
      lobby: w.lobby,
      startInterval: w.startInterval,
      endInterval: w.endInterval,
      startIdx: w.startIdx,
      endIdx: w.endIdx,
      averageDeficit: w.averageDeficit,
      effectiveDemand: w.effectiveDemand,
      toleranceIntervalsUsed: w.toleranceIntervalsUsed,
      shiftStart: w.shiftStart,
      shiftEnd: w.shiftEnd,
    });

    summary.total++;
    switch (w.otType) {
      case '1hr Pre Shift OT': summary.oneHrPre++; break;
      case '1hr Post Shift OT': summary.oneHrPost++; break;
      case '2hr Pre Shift OT': summary.twoHrPre++; break;
      case '2hr Post Shift OT': summary.twoHrPost++; break;
      case 'Full Day OT': summary.fullDay++; break;
    }
  }

  // 8. Compute revised heatmap
  const revisedHeatmap = computeRevisedHeatmapFromWindows(heatmapData, qualifiedWindows);

  // 9. Produce backward-compatible DeficitBlock records
  const deficitBlocks = produceDeficitBlocks(demandWindows);

  return {
    demandWindows,
    recommendations,
    revisedHeatmap,
    summary,
    deficitBlocks,
  };
}

// ── Internal helpers ──

function emptyResult(heatmapData: HeatmapRow[]): DemandResult {
  return {
    demandWindows: [],
    recommendations: [],
    revisedHeatmap: [...heatmapData],
    summary: { total: 0, oneHrPre: 0, oneHrPost: 0, twoHrPre: 0, twoHrPost: 0, fullDay: 0 },
    deficitBlocks: [],
  };
}

/**
 * Build interval map: groups heatmap data by "date|program|lobby"
 * → Map of intervalStartTime → overUnderValue
 */
function buildIntervalMap(
  heatmapData: HeatmapRow[],
  program: string,
): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const row of heatmapData) {
    if (row.program !== program) continue;
    const key = `${row.date}|${row.program}|${row.lobby}`;
    if (!map.has(key)) map.set(key, new Map());
    map.get(key)!.set(row.intervalStartTime, row.overUnderValue);
  }
  return map;
}

/**
 * Identify candidate OT windows for each shift on each date.
 * Mirrors the OT window selection logic from autoSlotGenerator:
 * - Try 2hr pre first; if no overlap with deficit, try 1hr pre
 * - Try 2hr post first; if no overlap with deficit, try 1hr post
 * - For WO agents, use Full Day OT
 */
function identifyCandidateWindows(
  shifts: ShiftEntry[],
  program: string,
  intervalMap: Map<string, Map<string, number>>,
): CandidateWindow[] {
  const candidates: CandidateWindow[] = [];

  // Build WO tracking structures (same as autoSlotGenerator)
  const agentWODays = new Map<string, string[]>();
  for (const s of shifts) {
    if (s.isWeeklyOff) {
      const d = agentWODays.get(s.agent) ?? [];
      d.push(s.date);
      agentWODays.set(s.agent, d);
    }
  }
  const agentWOOTCount = new Map<string, number>();

  // Find each agent's regular shift for WO Full Day OT
  const agentRegularShift = new Map<string, string>();
  for (const s of shifts) {
    if (!s.isWeeklyOff && s.shiftStart && s.shiftEnd && !agentRegularShift.has(s.agent)) {
      agentRegularShift.set(s.agent, `${s.shiftStart}-${s.shiftEnd}`);
    }
  }

  // Group shifts by date
  const shiftsByDate = new Map<string, ShiftEntry[]>();
  for (const s of shifts) {
    const d = shiftsByDate.get(s.date) ?? [];
    d.push(s);
    shiftsByDate.set(s.date, d);
  }

  const usedSlotKeys = new Set<string>();

  for (const [date, dateShifts] of shiftsByDate) {
    const workingAgents = dateShifts.filter(
      (s) => !s.isWeeklyOff && s.shiftStart && s.shiftEnd,
    );
    const woAgents = dateShifts.filter((s) => s.isWeeklyOff);

    // Process working agents: pre/post shift windows
    for (const shift of workingAgents) {
      const ssi = intervalIndex(shift.shiftStart);
      const sei = intervalIndex(shift.shiftEnd);
      const agentLobby = shift.lobby ?? '';
      const shiftStr = `${shift.shiftStart}-${shift.shiftEnd}`;
      const mapKey = `${date}|${program}|${agentLobby}`;
      const intervals = intervalMap.get(mapKey);

      const hasDeficitInRange = (s: number, e: number): boolean => {
        if (!intervals) return false;
        for (let i = s; i < e; i++) {
          const actualIdx = i % 48;
          if (actualIdx < 0) continue;
          const time = ALL_INTERVALS[actualIdx];
          const val = intervals.get(time);
          if (val !== undefined && val < 0) return true;
        }
        return false;
      };

      // Pre-shift windows: try 2hr first, then 1hr
      const pre2Start = ssi - 4;
      const pre2End = ssi;
      const pre1Start = ssi - 2;
      const pre1End = ssi;

      if (pre2Start >= 0 && hasDeficitInRange(pre2Start, pre2End)) {
        const k = `${date}|${shift.agent}|pre2|${shift.shiftStart}`;
        if (!usedSlotKeys.has(k)) {
          usedSlotKeys.add(k);
          candidates.push({
            date,
            program,
            lobby: agentLobby,
            startIdx: pre2Start,
            endIdx: pre2End,
            shiftStart: shift.shiftStart,
            shiftEnd: shift.shiftEnd,
            agent: shift.agent,
            manager: shift.manager,
            shiftStr,
            otType: '2hr Pre Shift OT',
            slotKey: k,
          });
        }
      } else if (pre1Start >= 0 && hasDeficitInRange(pre1Start, pre1End)) {
        const k = `${date}|${shift.agent}|pre1|${shift.shiftStart}`;
        if (!usedSlotKeys.has(k)) {
          usedSlotKeys.add(k);
          candidates.push({
            date,
            program,
            lobby: agentLobby,
            startIdx: pre1Start,
            endIdx: pre1End,
            shiftStart: shift.shiftStart,
            shiftEnd: shift.shiftEnd,
            agent: shift.agent,
            manager: shift.manager,
            shiftStr,
            otType: '1hr Pre Shift OT',
            slotKey: k,
          });
        }
      }

      // Post-shift windows: try 2hr first, then 1hr
      const post2Start = sei;
      const post2End = sei + 4;
      const post1Start = sei;
      const post1End = sei + 2;

      if (post2End <= 48 && hasDeficitInRange(post2Start, post2End)) {
        const k = `${date}|${shift.agent}|post2|${shift.shiftEnd}`;
        if (!usedSlotKeys.has(k)) {
          usedSlotKeys.add(k);
          candidates.push({
            date,
            program,
            lobby: agentLobby,
            startIdx: post2Start,
            endIdx: post2End,
            shiftStart: shift.shiftStart,
            shiftEnd: shift.shiftEnd,
            agent: shift.agent,
            manager: shift.manager,
            shiftStr,
            otType: '2hr Post Shift OT',
            slotKey: k,
          });
        }
      } else if (post1End <= 48 && hasDeficitInRange(post1Start, post1End)) {
        const k = `${date}|${shift.agent}|post1|${shift.shiftEnd}`;
        if (!usedSlotKeys.has(k)) {
          usedSlotKeys.add(k);
          candidates.push({
            date,
            program,
            lobby: agentLobby,
            startIdx: post1Start,
            endIdx: post1End,
            shiftStart: shift.shiftStart,
            shiftEnd: shift.shiftEnd,
            agent: shift.agent,
            manager: shift.manager,
            shiftStr,
            otType: '1hr Post Shift OT',
            slotKey: k,
          });
        }
      }
    }

    // WO agents → Full Day OT
    for (const shift of woAgents) {
      const woCount = agentWOOTCount.get(shift.agent) ?? 0;
      const totalWO = (agentWODays.get(shift.agent) ?? []).length;
      // Labor law: if agent has 2+ WO days and already has 1 WO OT, skip
      if (totalWO >= 2 && woCount >= 1) continue;

      const k = `${date}|${shift.agent}|fullday`;
      if (usedSlotKeys.has(k)) continue;
      usedSlotKeys.add(k);

      const rs = agentRegularShift.get(shift.agent) ?? 'Full Day';
      const agentLobby = shift.lobby ?? '';

      // Parse regular shift to get start/end indices
      let startIdx = 0;
      let endIdx = 48;
      const rsMatch = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(rs);
      if (rsMatch) {
        startIdx = intervalIndex(rsMatch[1]);
        endIdx = intervalIndex(rsMatch[2]);
      }

      candidates.push({
        date,
        program,
        lobby: agentLobby,
        startIdx,
        endIdx,
        shiftStart: rsMatch ? rsMatch[1] : '00:00',
        shiftEnd: rsMatch ? rsMatch[2] : '23:30',
        agent: shift.agent,
        manager: shift.manager,
        shiftStr: `WO (regular: ${rs})`,
        otType: 'Full Day OT',
        slotKey: k,
      });

      agentWOOTCount.set(shift.agent, woCount + 1);
    }
  }

  return candidates;
}

/**
 * Compute revised heatmap by adding effectiveDemand to each interval
 * covered by qualifying windows.
 */
function computeRevisedHeatmapFromWindows(
  originalData: HeatmapRow[],
  windows: Array<{ date: string; program: string; lobby: string; startIdx: number; endIdx: number; effectiveDemand: number }>,
): HeatmapRow[] {
  // Build a map of adjustments: "date|program|lobby|interval" → total demand to add
  const adjustments = new Map<string, number>();

  for (const w of windows) {
    for (let i = w.startIdx; i < w.endIdx; i++) {
      const actualIdx = i % 48;
      const time = ALL_INTERVALS[actualIdx];
      const key = `${w.date}|${w.program}|${w.lobby}|${time}`;
      adjustments.set(key, (adjustments.get(key) ?? 0) + w.effectiveDemand);
    }
  }

  return originalData.map((row) => {
    const key = `${row.date}|${row.program}|${row.lobby}|${row.intervalStartTime}`;
    const adj = adjustments.get(key);
    if (adj !== undefined) {
      return { ...row, overUnderValue: row.overUnderValue + adj };
    }
    return { ...row };
  });
}

/**
 * Produce backward-compatible DeficitBlock records from demand windows.
 * Groups contiguous demand windows by date+program into blocks.
 */
function produceDeficitBlocks(demandWindows: DemandWindow[]): DeficitBlock[] {
  const blocks: DeficitBlock[] = [];

  // Group by date+program+lobby
  const grouped = new Map<string, DemandWindow[]>();
  for (const w of demandWindows) {
    const key = `${w.date}|${w.program}|${w.lobby}`;
    const arr = grouped.get(key) ?? [];
    arr.push(w);
    grouped.set(key, arr);
  }

  for (const [, windows] of grouped) {
    // Sort by startIdx
    const sorted = [...windows].sort((a, b) => a.startIdx - b.startIdx);

    for (const w of sorted) {
      const count = w.endIdx - w.startIdx;
      blocks.push({
        date: w.date,
        program: w.program,
        startInterval: w.startInterval,
        endInterval: w.endInterval,
        count,
        startIdx: w.startIdx,
        endIdx: w.endIdx,
      });
    }
  }

  return blocks;
}

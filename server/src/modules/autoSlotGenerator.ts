import type { ShiftEntry, OTSlot, CreateSlotParams, OTRecommendation, DemandWindow, DeficitBlock } from '../types.js';
import { createSlotForAgent } from './slotManager.js';

const ALL_INTERVALS = Array.from({ length: 48 }, (_, i) => {
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

export function overlapsOrNear(a1: number, a2: number, b1: number, b2: number, proximity = 2): boolean {
  return a1 < b2 + proximity && b1 < a2 + proximity;
}

function shiftOverlapsDeficit(shiftStr: string, blockStartIdx: number, blockEndIdx: number): boolean {
  const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(shiftStr);
  if (!match) return false;
  let ssi = intervalIndex(match[1]);
  let sei = intervalIndex(match[2]);
  // Handle overnight shifts
  if (sei <= ssi) sei += 48;
  let bEnd = blockEndIdx;
  if (bEnd <= blockStartIdx) bEnd += 48;
  // Check overlap
  return ssi < bEnd && blockStartIdx < sei;
}

export interface AutoSlotResult {
  slots: OTSlot[];
  summary: { total: number; oneHrPre: number; oneHrPost: number; twoHrPre: number; twoHrPost: number; fullDay: number };
  deficitBlocks: DeficitBlock[];
  debug: string[];
  recommendations: OTRecommendation[];
}

export function generateAutoSlots(
  shifts: ShiftEntry[],
  demandWindows: DemandWindow[],
  program: string,
): AutoSlotResult {
  const debug: string[] = [];
  const slots: OTSlot[] = [];
  const recommendations: OTRecommendation[] = [];
  let oneHrPre = 0, oneHrPost = 0, twoHrPre = 0, twoHrPost = 0, fullDay = 0;

  const usedSlotKeys = new Set<string>();
  const agentWODays = new Map<string, string[]>();
  for (const s of shifts) {
    if (s.isWeeklyOff) {
      const d = agentWODays.get(s.agent) ?? [];
      d.push(s.date);
      agentWODays.set(s.agent, d);
    }
  }
  const agentWOOTCount = new Map<string, number>();
  const agentRegularShift = new Map<string, string>();
  for (const s of shifts) {
    if (!s.isWeeklyOff && s.shiftStart && s.shiftEnd && !agentRegularShift.has(s.agent))
      agentRegularShift.set(s.agent, `${s.shiftStart}-${s.shiftEnd}`);
  }

  const addSlot = (params: CreateSlotParams, rec: OTRecommendation) => {
    slots.push(createSlotForAgent(params, rec.agent, rec.agent));
    recommendations.push(rec);
  };

  // Build deficit blocks from demand windows for backward compatibility
  const deficitBlocks: DeficitBlock[] = demandWindows.map((w) => ({
    date: w.date,
    program: w.program,
    startInterval: w.startInterval,
    endInterval: w.endInterval,
    count: w.endIdx - w.startIdx,
    startIdx: w.startIdx,
    endIdx: w.endIdx,
  }));

  for (const window of demandWindows) {
    debug.push(`Window: ${window.date} ${window.startInterval}-${window.endInterval} (${window.endIdx - window.startIdx} intervals)`);
    const dateAgents = shifts.filter((s) => s.date === window.date);
    const workingAgents = dateAgents.filter((s) => !s.isWeeklyOff && s.shiftStart && s.shiftEnd);
    const woAgents = dateAgents.filter((s) => s.isWeeklyOff);
    debug.push(`  Agents on ${window.date}: ${dateAgents.length} (working: ${workingAgents.length}, WO: ${woAgents.length})`);

    // Initialize deficit tracker for headcount-aware assignment
    const deficitTracker = new Map<string, number>();
    for (let i = window.startIdx; i < window.endIdx; i++) {
      const interval = ALL_INTERVALS[i % 48];
      // Use effectiveDemand as a proxy for deficit magnitude per interval
      deficitTracker.set(interval, Math.max(window.effectiveDemand, 1));
    }

    function hasRemainingDeficit(startIdx: number, endIdx: number): boolean {
      for (let i = startIdx; i < endIdx; i++) {
        const interval = ALL_INTERVALS[i % 48];
        if ((deficitTracker.get(interval) ?? 0) > 0) return true;
      }
      return false;
    }

    function decrementDeficit(startIdx: number, endIdx: number): void {
      for (let i = startIdx; i < endIdx; i++) {
        const interval = ALL_INTERVALS[i % 48];
        const current = deficitTracker.get(interval) ?? 0;
        if (current > 0) deficitTracker.set(interval, current - 1);
      }
    }

    // Pass 1: Working agents — pre/post shift OT (with proximity check)
    for (const shift of workingAgents) {
      if (!hasRemainingDeficit(window.startIdx, window.endIdx)) break;

      const ssi = intervalIndex(shift.shiftStart);
      const sei = intervalIndex(shift.shiftEnd);
      const shiftStr = `${shift.shiftStart}-${shift.shiftEnd}`;
      const defStr = `${window.startInterval}-${window.endInterval}`;
      const agentLobby = shift.lobby ?? '';

      // 2hr Pre Shift
      const pre2 = { s: ssi - 4, e: ssi };
      if (pre2.s >= 0 && overlapsOrNear(window.startIdx, window.endIdx, pre2.s, pre2.e)) {
        const k = `${window.date}|${shift.agent}|pre2|${shift.shiftStart}`;
        if (!usedSlotKeys.has(k) && hasRemainingDeficit(window.startIdx, window.endIdx)) {
          const tw = `${indexToTime(Math.max(pre2.s, 0))}-${shift.shiftStart}`;
          addSlot({ otType: '2hr Pre Shift OT', date: window.date, program, lobby: agentLobby, timeWindow: tw },
            { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: shiftStr, otType: '2hr Pre Shift OT', otTimeWindow: tw, deficitBlock: defStr });
          twoHrPre++; usedSlotKeys.add(k);
          decrementDeficit(pre2.s, pre2.e);
        }
      }
      // 1hr Pre Shift
      else {
        const pre1 = { s: ssi - 2, e: ssi };
        if (pre1.s >= 0 && overlapsOrNear(window.startIdx, window.endIdx, pre1.s, pre1.e)) {
          const k = `${window.date}|${shift.agent}|pre1|${shift.shiftStart}`;
          if (!usedSlotKeys.has(k) && hasRemainingDeficit(window.startIdx, window.endIdx)) {
            const tw = `${indexToTime(Math.max(pre1.s, 0))}-${shift.shiftStart}`;
            addSlot({ otType: '1hr Pre Shift OT', date: window.date, program, lobby: agentLobby, timeWindow: tw },
              { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: shiftStr, otType: '1hr Pre Shift OT', otTimeWindow: tw, deficitBlock: defStr });
            oneHrPre++; usedSlotKeys.add(k);
            decrementDeficit(pre1.s, pre1.e);
          }
        }
      }

      // 2hr Post Shift
      const post2 = { s: sei, e: sei + 4 };
      if (post2.e <= 48 && overlapsOrNear(window.startIdx, window.endIdx, post2.s, post2.e)) {
        const k = `${window.date}|${shift.agent}|post2|${shift.shiftEnd}`;
        if (!usedSlotKeys.has(k) && hasRemainingDeficit(window.startIdx, window.endIdx)) {
          const tw = `${shift.shiftEnd}-${indexToTime(Math.min(post2.e, 48))}`;
          addSlot({ otType: '2hr Post Shift OT', date: window.date, program, lobby: agentLobby, timeWindow: tw },
            { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: shiftStr, otType: '2hr Post Shift OT', otTimeWindow: tw, deficitBlock: defStr });
          twoHrPost++; usedSlotKeys.add(k);
          decrementDeficit(post2.s, post2.e);
        }
      }
      // 1hr Post Shift
      else {
        const post1 = { s: sei, e: sei + 2 };
        if (post1.e <= 48 && overlapsOrNear(window.startIdx, window.endIdx, post1.s, post1.e)) {
          const k = `${window.date}|${shift.agent}|post1|${shift.shiftEnd}`;
          if (!usedSlotKeys.has(k) && hasRemainingDeficit(window.startIdx, window.endIdx)) {
            const tw = `${shift.shiftEnd}-${indexToTime(Math.min(post1.e, 48))}`;
            addSlot({ otType: '1hr Post Shift OT', date: window.date, program, lobby: agentLobby, timeWindow: tw },
              { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: shiftStr, otType: '1hr Post Shift OT', otTimeWindow: tw, deficitBlock: defStr });
            oneHrPost++; usedSlotKeys.add(k);
            decrementDeficit(post1.s, post1.e);
          }
        }
      }
    }

    // Pass 2: WO agents → Full Day OT (with shift-overlap filter and headcount tracking)
    for (const shift of woAgents) {
      if (!hasRemainingDeficit(window.startIdx, window.endIdx)) break;

      const k = `${window.date}|${shift.agent}|fullday`;
      const woCount = agentWOOTCount.get(shift.agent) ?? 0;
      const totalWO = (agentWODays.get(shift.agent) ?? []).length;
      if (totalWO >= 2 && woCount >= 1) { debug.push(`  Skipping ${shift.agent}: labor law WO limit`); continue; }

      const rs = agentRegularShift.get(shift.agent);
      if (!rs || !shiftOverlapsDeficit(rs, window.startIdx, window.endIdx)) {
        debug.push(`  Skipping ${shift.agent}: regular shift ${rs ?? 'unknown'} does not overlap deficit`);
        continue;
      }

      const agentLobby = shift.lobby ?? '';
      if (!usedSlotKeys.has(k)) {
        addSlot({ otType: 'Full Day OT', date: window.date, program, lobby: agentLobby, timeWindow: rs },
          { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: `WO (regular: ${rs})`, otType: 'Full Day OT', otTimeWindow: rs, deficitBlock: `${window.startInterval}-${window.endInterval}` });
        fullDay++; usedSlotKeys.add(k); agentWOOTCount.set(shift.agent, woCount + 1);
        // Decrement deficit for the WO agent's regular shift intervals that overlap the window
        const rsMatch = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(rs);
        if (rsMatch) {
          let rsSi = intervalIndex(rsMatch[1]);
          let rsSei = intervalIndex(rsMatch[2]);
          if (rsSei <= rsSi) rsSei += 48;
          decrementDeficit(Math.max(rsSi, window.startIdx), Math.min(rsSei, window.endIdx));
        }
      }
    }

    // Fallback: 4+ intervals, WO agents only (with shift-overlap filter)
    if (!hasRemainingDeficit(window.startIdx, window.endIdx)) {
      debug.push(`  Window fully covered`);
    } else if ((window.endIdx - window.startIdx) >= 4) {
      debug.push(`  Fallback: Full Day OT for WO agents on ${window.date}`);
      for (const shift of dateAgents.filter((s) => s.isWeeklyOff)) {
        if (!hasRemainingDeficit(window.startIdx, window.endIdx)) break;

        const woCount = agentWOOTCount.get(shift.agent) ?? 0;
        const totalWO = (agentWODays.get(shift.agent) ?? []).length;
        if (totalWO >= 2 && woCount >= 1) continue;

        const rs = agentRegularShift.get(shift.agent);
        if (!rs || !shiftOverlapsDeficit(rs, window.startIdx, window.endIdx)) {
          debug.push(`  Skipping ${shift.agent}: regular shift ${rs ?? 'unknown'} does not overlap deficit`);
          continue;
        }

        const agentLobby = shift.lobby ?? '';
        const k = `${window.date}|${shift.agent}|fullday_fb`;
        if (!usedSlotKeys.has(k)) {
          addSlot({ otType: 'Full Day OT', date: window.date, program, lobby: agentLobby, timeWindow: rs },
            { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: `WO (regular: ${rs})`, otType: 'Full Day OT', otTimeWindow: rs, deficitBlock: `${window.startInterval}-${window.endInterval}` });
          fullDay++; usedSlotKeys.add(k); agentWOOTCount.set(shift.agent, (agentWOOTCount.get(shift.agent) ?? 0) + 1);
          // Decrement deficit for the WO agent's regular shift intervals that overlap the window
          const rsMatch = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(rs);
          if (rsMatch) {
            let rsSi = intervalIndex(rsMatch[1]);
            let rsSei = intervalIndex(rsMatch[2]);
            if (rsSei <= rsSi) rsSei += 48;
            decrementDeficit(Math.max(rsSi, window.startIdx), Math.min(rsSei, window.endIdx));
          }
        }
      }
    }
    debug.push(`  Window processing complete`);
  }

  return { slots, summary: { total: slots.length, oneHrPre, oneHrPost, twoHrPre, twoHrPost, fullDay }, deficitBlocks, debug, recommendations };
}

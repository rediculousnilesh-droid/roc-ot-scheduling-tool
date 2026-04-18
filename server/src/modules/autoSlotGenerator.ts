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
    let windowMatched = false;

    for (const shift of workingAgents) {
      const ssi = intervalIndex(shift.shiftStart);
      const sei = intervalIndex(shift.shiftEnd);
      const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;
      const shiftStr = `${shift.shiftStart}-${shift.shiftEnd}`;
      const defStr = `${window.startInterval}-${window.endInterval}`;
      const agentLobby = shift.lobby ?? '';

      // 2hr Pre Shift
      const pre2 = { s: ssi - 4, e: ssi };
      if (pre2.s >= 0 && overlaps(window.startIdx, window.endIdx, pre2.s, pre2.e)) {
        const k = `${window.date}|${shift.agent}|pre2|${shift.shiftStart}`;
        if (!usedSlotKeys.has(k)) {
          const tw = `${indexToTime(Math.max(pre2.s, 0))}-${shift.shiftStart}`;
          addSlot({ otType: '2hr Pre Shift OT', date: window.date, program, lobby: agentLobby, timeWindow: tw },
            { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: shiftStr, otType: '2hr Pre Shift OT', otTimeWindow: tw, deficitBlock: defStr });
          twoHrPre++; usedSlotKeys.add(k); windowMatched = true;
        }
      } else {
        // 1hr Pre Shift
        const pre1 = { s: ssi - 2, e: ssi };
        if (pre1.s >= 0 && overlaps(window.startIdx, window.endIdx, pre1.s, pre1.e)) {
          const k = `${window.date}|${shift.agent}|pre1|${shift.shiftStart}`;
          if (!usedSlotKeys.has(k)) {
            const tw = `${indexToTime(Math.max(pre1.s, 0))}-${shift.shiftStart}`;
            addSlot({ otType: '1hr Pre Shift OT', date: window.date, program, lobby: agentLobby, timeWindow: tw },
              { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: shiftStr, otType: '1hr Pre Shift OT', otTimeWindow: tw, deficitBlock: defStr });
            oneHrPre++; usedSlotKeys.add(k); windowMatched = true;
          }
        }
      }

      // 2hr Post Shift
      const post2 = { s: sei, e: sei + 4 };
      if (post2.e <= 48 && overlaps(window.startIdx, window.endIdx, post2.s, post2.e)) {
        const k = `${window.date}|${shift.agent}|post2|${shift.shiftEnd}`;
        if (!usedSlotKeys.has(k)) {
          const tw = `${shift.shiftEnd}-${indexToTime(Math.min(post2.e, 48))}`;
          addSlot({ otType: '2hr Post Shift OT', date: window.date, program, lobby: agentLobby, timeWindow: tw },
            { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: shiftStr, otType: '2hr Post Shift OT', otTimeWindow: tw, deficitBlock: defStr });
          twoHrPost++; usedSlotKeys.add(k); windowMatched = true;
        }
      } else {
        // 1hr Post Shift
        const post1 = { s: sei, e: sei + 2 };
        if (post1.e <= 48 && overlaps(window.startIdx, window.endIdx, post1.s, post1.e)) {
          const k = `${window.date}|${shift.agent}|post1|${shift.shiftEnd}`;
          if (!usedSlotKeys.has(k)) {
            const tw = `${shift.shiftEnd}-${indexToTime(Math.min(post1.e, 48))}`;
            addSlot({ otType: '1hr Post Shift OT', date: window.date, program, lobby: agentLobby, timeWindow: tw },
              { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: shiftStr, otType: '1hr Post Shift OT', otTimeWindow: tw, deficitBlock: defStr });
            oneHrPost++; usedSlotKeys.add(k); windowMatched = true;
          }
        }
      }
    }

    // WO agents → Full Day OT
    for (const shift of woAgents) {
      const k = `${window.date}|${shift.agent}|fullday`;
      const woCount = agentWOOTCount.get(shift.agent) ?? 0;
      const totalWO = (agentWODays.get(shift.agent) ?? []).length;
      if (totalWO >= 2 && woCount >= 1) { debug.push(`  Skipping ${shift.agent}: labor law WO limit`); continue; }
      if (!usedSlotKeys.has(k)) {
        const rs = agentRegularShift.get(shift.agent) ?? 'Full Day';
        const agentLobby = shift.lobby ?? '';
        addSlot({ otType: 'Full Day OT', date: window.date, program, lobby: agentLobby, timeWindow: rs },
          { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: `WO (regular: ${rs})`, otType: 'Full Day OT', otTimeWindow: rs, deficitBlock: `${window.startInterval}-${window.endInterval}` });
        fullDay++; usedSlotKeys.add(k); agentWOOTCount.set(shift.agent, woCount + 1); windowMatched = true;
      }
    }

    if (!windowMatched && (window.endIdx - window.startIdx) >= 4) {
      for (const shift of dateAgents.filter((s) => s.isWeeklyOff)) {
        const woCount = agentWOOTCount.get(shift.agent) ?? 0;
        const totalWO = (agentWODays.get(shift.agent) ?? []).length;
        if (totalWO >= 2 && woCount >= 1) continue;
        const k = `${window.date}|${shift.agent}|fullday_fb`;
        if (!usedSlotKeys.has(k)) {
          const rs = agentRegularShift.get(shift.agent) ?? 'Full Day';
          const agentLobby = shift.lobby ?? '';
          addSlot({ otType: 'Full Day OT', date: window.date, program, lobby: agentLobby, timeWindow: rs },
            { date: window.date, program, lobby: agentLobby, agent: shift.agent, manager: shift.manager, shift: `WO (regular: ${rs})`, otType: 'Full Day OT', otTimeWindow: rs, deficitBlock: `${window.startInterval}-${window.endInterval}` });
          fullDay++; usedSlotKeys.add(k); agentWOOTCount.set(shift.agent, (agentWOOTCount.get(shift.agent) ?? 0) + 1);
        }
      }
    }
  }

  return { slots, summary: { total: slots.length, oneHrPre, oneHrPost, twoHrPre, twoHrPost, fullDay }, deficitBlocks, debug, recommendations };
}

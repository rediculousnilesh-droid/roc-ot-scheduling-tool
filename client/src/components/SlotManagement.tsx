import { useState, useMemo, useRef } from 'react';
import type { OTSlot, ShiftEntry, HeatmapRow } from '../types';
import * as api from '../api/httpClient';
import { downloadCSV } from '../modules/csvDownload';
import SlotList from './SlotList';
import SlotNumber from './SlotNumber';
import FillRateHeatmap from './FillRateHeatmap';
import ToleranceConfig from './ToleranceConfig';
import styles from './SlotManagement.module.css';

/** Result of the shared OT demand computation */
interface OTDemandResult {
  dates: string[];
  rows: { otType: string; shift: string }[];
  demandMap: Map<string, number>;
  adjustments: Map<string, number>;
}

interface Props {
  slots: OTSlot[];
  shifts: ShiftEntry[];
  heatmap?: HeatmapRow[];
  revised?: HeatmapRow[];
  programs: string[];
  lobbies: string[];
  onRefresh?: () => void;
  initialProgram?: string;
  initialLobby?: string;
  initialWeek?: string;
  onSelectionChange?: (program: string, lobby: string, week: string) => void;
}

/** Derive shift name from OT window using roster */
function deriveShift(otType: string, tw: string, date: string, shifts: ShiftEntry[]): string {
  if (otType === 'Full Day OT') return tw;
  const m = tw.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return tw;
  for (const s of shifts) {
    if (s.date !== date || s.isWeeklyOff || !s.shiftStart || !s.shiftEnd) continue;
    if (otType.includes('Pre Shift') && m[2] === s.shiftStart) return `${s.shiftStart}-${s.shiftEnd}`;
    if (otType.includes('Post Shift') && m[1] === s.shiftEnd) return `${s.shiftStart}-${s.shiftEnd}`;
  }
  return tw;
}

function fmtDate(d: string): string {
  const p = d.split('-');
  if (p.length !== 3) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(p[2])}-${months[parseInt(p[1]) - 1]}-${p[0].slice(2)}`;
}

function intervalIdx(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 2 + (m >= 30 ? 1 : 0);
}

/**
 * Shared OT demand computation. Produces both the table data (demandMap, rows, dates)
 * AND the interval-level adjustments for the heatmap, from a single pass of logic.
 * This guarantees the After Demand OT heatmap exactly matches the OT Demand table numbers.
 */
function computeOTDemand(heatmap: HeatmapRow[], shifts: ShiftEntry[], program: string, tolerance: number): OTDemandResult {
  const empty: OTDemandResult = { dates: [], rows: [], demandMap: new Map(), adjustments: new Map() };
  if (!heatmap?.length || !shifts?.length) return empty;

  const tol = tolerance ?? -2;

  // Get heatmap for this program
  const hmByDate = new Map<string, Map<number, number>>();
  const allDates = new Set<string>();
  for (const r of heatmap) {
    if (r.program !== program) continue;
    allDates.add(r.date);
    if (!hmByDate.has(r.date)) hmByDate.set(r.date, new Map());
    const idx = intervalIdx(r.intervalStartTime);
    const existing = hmByDate.get(r.date)!.get(idx) ?? 0;
    hmByDate.get(r.date)!.set(idx, existing + r.overUnderValue);
  }
  const dates = [...allDates].sort();

  // Get unique shift patterns (from working agents)
  const shiftPatterns = new Set<string>();
  for (const s of shifts) {
    if (s.program !== program || s.isWeeklyOff || !s.shiftStart || !s.shiftEnd) continue;
    shiftPatterns.add(`${s.shiftStart}-${s.shiftEnd}`);
  }

  // Get WO agents' regular shift patterns (for Full Day OT)
  const agentRegularShift = new Map<string, string>();
  for (const s of shifts) {
    if (!s.isWeeklyOff && s.shiftStart && s.shiftEnd && !agentRegularShift.has(s.agent)) {
      agentRegularShift.set(s.agent, `${s.shiftStart}-${s.shiftEnd}`);
    }
  }
  const woShiftPatterns = new Set<string>();
  for (const s of shifts) {
    if (s.program !== program || !s.isWeeklyOff) continue;
    const rs = agentRegularShift.get(s.agent);
    if (rs) woShiftPatterns.add(rs);
  }

  const demandMap = new Map<string, number>();
  const adjustments = new Map<string, number>();
  const rowSet = new Map<string, Set<string>>();
  const otTypeOrder = ['2hr Pre Shift OT', '1hr Pre Shift OT', '2hr Post Shift OT', '1hr Post Shift OT', 'Full Day OT'];

  // Tolerance budget: max 2 intervals per shift|day|program can use tolerance
  const toleranceBudget = new Map<string, number>();

  /** Add demand HC to the adjustments map for a range of interval indices on a given date */
  const addAdjustments = (date: string, fromIdx: number, toIdx: number, demand: number) => {
    for (let i = fromIdx; i < toIdx; i++) {
      const h = String(Math.floor(i / 2)).padStart(2, '0');
      const m = i % 2 === 0 ? '00' : '30';
      const key = `${date}|${h}:${m}`;
      adjustments.set(key, (adjustments.get(key) ?? 0) + demand);
    }
  };

  for (const date of dates) {
    const intervals = hmByDate.get(date);
    if (!intervals) continue;

    for (const sp of shiftPatterns) {
      const [startStr, endStr] = sp.split('-');
      const ssi = intervalIdx(startStr);
      const sei = intervalIdx(endStr);
      const budgetKey = `${sp}|${date}|${program}`;

      // Pre Shift: check 1hr window first (closer to shift), then 2hr if further intervals also have deficit
      const pre1Start = Math.max(ssi - 2, 0);
      const pre2Start = Math.max(ssi - 4, 0);
      
      // Check 1hr window (2 intervals before shift)
      let pre1HasDeficit = false;
      let pre1MinDeficit = 0;
      let pre1Count = 0;
      for (let i = pre1Start; i < ssi; i++) {
        const val = intervals.get(i);
        if (val !== undefined) { pre1Count++; if (val < pre1MinDeficit) pre1MinDeficit = val; if (val < tol) pre1HasDeficit = true; }
      }
      
      // Check extended 2hr window (4 intervals before shift)
      let pre2HasDeficit = false;
      let pre2MinDeficit = 0;
      let pre2Count = 0;
      for (let i = pre2Start; i < ssi; i++) {
        const val = intervals.get(i);
        if (val !== undefined) { pre2Count++; if (val < pre2MinDeficit) pre2MinDeficit = val; if (val < tol) pre2HasDeficit = true; }
      }
      
      // Check if the further 2 intervals (beyond 1hr) also have deficit
      let preFarHasDeficit = false;
      for (let i = pre2Start; i < pre1Start; i++) {
        const val = intervals.get(i);
        if (val !== undefined && val < tol) { preFarHasDeficit = true; break; }
      }
      
      if (pre2Count > 0 && pre2HasDeficit && preFarHasDeficit && pre2Start < pre1Start) {
        // 2hr pre-shift: deficit in both near and far intervals
        const effectiveDemand = Math.ceil(Math.abs(pre2MinDeficit));
        const key = `2hr Pre Shift OT|${sp}|${date}`;
        demandMap.set(key, effectiveDemand);
        if (!rowSet.has('2hr Pre Shift OT')) rowSet.set('2hr Pre Shift OT', new Set());
        rowSet.get('2hr Pre Shift OT')!.add(sp);
        addAdjustments(date, pre2Start, ssi, effectiveDemand);
      } else if (pre1Count > 0 && pre1HasDeficit) {
        // 1hr pre-shift: deficit only in near intervals
        const effectiveDemand = Math.ceil(Math.abs(pre1MinDeficit));
        const key = `1hr Pre Shift OT|${sp}|${date}`;
        demandMap.set(key, effectiveDemand);
        if (!rowSet.has('1hr Pre Shift OT')) rowSet.set('1hr Pre Shift OT', new Set());
        rowSet.get('1hr Pre Shift OT')!.add(sp);
        addAdjustments(date, pre1Start, ssi, effectiveDemand);
      }

      // Post Shift: check 1hr window first (closer to shift), then 2hr if further intervals also have deficit
      const post1End = Math.min(sei + 2, 48);
      const post2End = Math.min(sei + 4, 48);
      
      // Check 1hr window (2 intervals after shift)
      let post1HasDeficit = false;
      let post1MinDeficit = 0;
      let post1Count = 0;
      for (let i = sei; i < post1End; i++) {
        const val = intervals.get(i);
        if (val !== undefined) { post1Count++; if (val < post1MinDeficit) post1MinDeficit = val; if (val < tol) post1HasDeficit = true; }
      }
      
      // Check extended 2hr window (4 intervals after shift)
      let post2HasDeficit = false;
      let post2MinDeficit = 0;
      let post2Count = 0;
      for (let i = sei; i < post2End; i++) {
        const val = intervals.get(i);
        if (val !== undefined) { post2Count++; if (val < post2MinDeficit) post2MinDeficit = val; if (val < tol) post2HasDeficit = true; }
      }
      
      // Check if the further 2 intervals (beyond 1hr) also have deficit
      let postFarHasDeficit = false;
      for (let i = post1End; i < post2End; i++) {
        const val = intervals.get(i);
        if (val !== undefined && val < tol) { postFarHasDeficit = true; break; }
      }
      
      if (post2Count > 0 && post2HasDeficit && postFarHasDeficit && post1End < post2End) {
        // 2hr post-shift: deficit in both near and far intervals
        const effectiveDemand = Math.ceil(Math.abs(post2MinDeficit));
        const key = `2hr Post Shift OT|${sp}|${date}`;
        demandMap.set(key, effectiveDemand);
        if (!rowSet.has('2hr Post Shift OT')) rowSet.set('2hr Post Shift OT', new Set());
        rowSet.get('2hr Post Shift OT')!.add(sp);
        addAdjustments(date, sei, post2End, effectiveDemand);
      } else if (post1Count > 0 && post1HasDeficit) {
        // 1hr post-shift: deficit only in near intervals
        const effectiveDemand = Math.ceil(Math.abs(post1MinDeficit));
        const key = `1hr Post Shift OT|${sp}|${date}`;
        demandMap.set(key, effectiveDemand);
        if (!rowSet.has('1hr Post Shift OT')) rowSet.set('1hr Post Shift OT', new Set());
        rowSet.get('1hr Post Shift OT')!.add(sp);
        addAdjustments(date, sei, post1End, effectiveDemand);
      }
    }

    // Full Day OT: for WO agents' regular shift patterns, check if there are 4+ consecutive
    // deficit intervals below tolerance during that shift window.
    for (const sp of woShiftPatterns) {
      const [startStr, endStr] = sp.split('-');
      const ssi = intervalIdx(startStr);
      const sei = intervalIdx(endStr);

      let consecDeficit = 0;
      let maxConsec = 0;
      let midDeficitTotal = 0;
      let midDeficitCount = 0;
      for (let i = ssi; i < sei; i++) {
        const val = intervals.get(i) ?? 0;
        if (val < tol) {
          consecDeficit++;
          midDeficitTotal += Math.abs(val - tol);
          midDeficitCount++;
          if (consecDeficit > maxConsec) maxConsec = consecDeficit;
        } else {
          consecDeficit = 0;
        }
      }
      if (maxConsec >= 4) {
        const demand = midDeficitCount > 0 ? Math.ceil(midDeficitTotal / midDeficitCount) : 1;
        const key = `Full Day OT|${sp}|${date}`;
        demandMap.set(key, demand);
        if (!rowSet.has('Full Day OT')) rowSet.set('Full Day OT', new Set());
        rowSet.get('Full Day OT')!.add(sp);
        // Add adjustments for the full shift window
        addAdjustments(date, ssi, sei, demand);
      }
    }
  }

  const rows: { otType: string; shift: string }[] = [];
  for (const ot of otTypeOrder) {
    const shiftsForType = rowSet.get(ot);
    if (!shiftsForType) continue;
    for (const shift of [...shiftsForType].sort()) rows.push({ otType: ot, shift });
  }

  return { dates, rows, demandMap, adjustments };
}

/** OT Demand Analysis — shows theoretical OT need from heatmap deficit, independent of headcount */
function OTDemandTable({ dates, rows, demandMap, animKey }: { dates: string[]; rows: { otType: string; shift: string }[]; demandMap: Map<string, number>; animKey: number }) {

  if (!rows.length) return null;

  const otTypeRowCounts = new Map<string, number>();
  for (const r of rows) otTypeRowCounts.set(r.otType, (otTypeRowCounts.get(r.otType) ?? 0) + 1);
  let lastOT = '';

  return (
    <div style={{ marginTop: 12 }}>
      <style>{`
        @keyframes demandFlashGlow {
          0% { box-shadow: 0 0 0 rgba(180,83,9,0); }
          50% { box-shadow: 0 0 12px rgba(180,83,9,0.3); }
          100% { box-shadow: 0 0 0 rgba(180,83,9,0); }
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 14, color: '#b45309' }}>📊 OT Demand Analysis (Heatmap-Based)</strong>
        <button style={{ padding: '4px 10px', fontSize: 11, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', borderRadius: 4, cursor: 'pointer' }}
          onClick={() => {
            const headers = ['OT Type', 'Shift', ...dates.map(fmtDate)];
            const csvRows = rows.map(r => [r.otType, r.shift, ...dates.map(d => String(demandMap.get(`${r.otType}|${r.shift}|${d}`) ?? ''))]);
            downloadCSV(headers, csvRows, 'ot_demand_analysis.csv');
          }}>⬇ Download CSV</button>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #fde68a', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, whiteSpace: 'nowrap' }}>
          <thead>
            <tr style={{ background: '#fffbeb' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #fbbf24', fontWeight: 700 }}>OT Type</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #fbbf24', fontWeight: 700 }}>Shift</th>
              {dates.map(d => <th key={d} style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '2px solid #fbbf24', fontWeight: 700 }}>{fmtDate(d)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const showOT = r.otType !== lastOT;
              if (showOT) lastOT = r.otType;
              const rowSpan = showOT ? otTypeRowCounts.get(r.otType) ?? 1 : 0;
              return (
                <tr key={i} style={{ borderBottom: '1px solid #fef3c7' }}>
                  {showOT && <td rowSpan={rowSpan} style={{ padding: '5px 10px', fontWeight: 600, background: '#fffbeb', borderRight: '1px solid #fef3c7', verticalAlign: 'top' }}>{r.otType}</td>}
                  <td style={{ padding: '5px 10px', fontWeight: 500 }}>{r.shift}</td>
                  {dates.map(d => {
                    const count = demandMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0;
                    return (
                      <td key={d} style={{
                        padding: '5px 10px', textAlign: 'center',
                        fontWeight: count > 0 ? 700 : 400,
                        color: count > 0 ? '#b45309' : '#cbd5e1',
                        overflow: 'hidden',
                        animation: count > 0 && animKey > 0 ? `demandFlashGlow 0.8s ease ${(i * 0.1 + dates.indexOf(d) * 0.15 + 1)}s` : 'none',
                        borderRadius: 4,
                      }}>
                        {count > 0 ? (
                          <SlotNumber
                            value={count}
                            delay={(i * 100 + dates.indexOf(d) * 150)}
                            animKey={animKey}
                          />
                        ) : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr style={{ borderTop: '2px solid #fbbf24', background: '#fffbeb' }}>
              <td colSpan={2} style={{ padding: '6px 10px', fontWeight: 700, color: '#b45309' }}>Total</td>
              {dates.map(d => {
                let total = 0;
                rows.forEach(r => { total += demandMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0; });
                return <td key={d} style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700, color: '#b45309' }}>{total > 0 ? total : ''}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Pivot table: OT Type × Shift rows, Date columns, count values */
function OTPivotTable({ slots, shifts, animKey, allDates }: { slots: OTSlot[]; shifts: ShiftEntry[]; animKey: number; allDates?: string[] }) {
  const dates = useMemo(() => allDates ? [...allDates].sort() : [...new Set(slots.map(s => s.date))].sort(), [slots, allDates]);
  const otTypeOrder = ['1hr Pre Shift OT', '1hr Post Shift OT', '2hr Pre Shift OT', '2hr Post Shift OT', 'Full Day OT'];

  const { rows, countMap } = useMemo(() => {
    const countMap = new Map<string, number>();
    const rowSet = new Map<string, Set<string>>();

    for (const s of slots) {
      const shift = deriveShift(s.otType, s.timeWindow, s.date, shifts);
      const key = `${s.otType}|${shift}|${s.date}`;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
      if (!rowSet.has(s.otType)) rowSet.set(s.otType, new Set());
      rowSet.get(s.otType)!.add(shift);
    }

    const rows: { otType: string; shift: string }[] = [];
    for (const ot of otTypeOrder) {
      const shiftsForType = rowSet.get(ot);
      if (!shiftsForType) continue;
      for (const shift of [...shiftsForType].sort()) {
        rows.push({ otType: ot, shift });
      }
    }
    // Add any types not in predefined order
    for (const [ot, shiftsSet] of rowSet) {
      if (!otTypeOrder.includes(ot)) {
        for (const shift of [...shiftsSet].sort()) rows.push({ otType: ot, shift });
      }
    }

    return { rows, countMap };
  }, [slots, shifts]);

  const otTypeRowCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.otType, (counts.get(r.otType) ?? 0) + 1);
    return counts;
  }, [rows]);

  if (!slots.length) return null;

  let lastOT = '';

  return (
    <div style={{ marginTop: 12 }}>
      <style>{`
        @keyframes flashGlow {
          0% { box-shadow: 0 0 0 rgba(74,144,217,0); }
          50% { box-shadow: 0 0 12px rgba(74,144,217,0.3); }
          100% { box-shadow: 0 0 0 rgba(74,144,217,0); }
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 14, color: '#1e293b' }}>OT Summary by Type, Shift & Date</strong>
        <button style={{ padding: '4px 10px', fontSize: 11, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 4, cursor: 'pointer' }}
          onClick={() => {
            const headers = ['OT Type', 'Shift', ...dates.map(fmtDate)];
            const csvRows = rows.map(r => [r.otType, r.shift, ...dates.map(d => String(countMap.get(`${r.otType}|${r.shift}|${d}`) ?? ''))]);
            downloadCSV(headers, csvRows, 'ot_pivot_summary.csv');
          }}>⬇ Download CSV</button>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, whiteSpace: 'nowrap' }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #cbd5e1', fontWeight: 700 }}>OT Type</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #cbd5e1', fontWeight: 700 }}>Shift</th>
              {dates.map(d => <th key={d} style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '2px solid #cbd5e1', fontWeight: 700 }}>{fmtDate(d)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const showOT = r.otType !== lastOT;
              if (showOT) lastOT = r.otType;
              const rowSpan = showOT ? otTypeRowCounts.get(r.otType) ?? 1 : 0;
              return (
                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  {showOT && (
                    <td rowSpan={rowSpan} style={{ padding: '5px 10px', fontWeight: 600, background: '#fafafa', borderRight: '1px solid #e2e8f0', verticalAlign: 'top' }}>
                      {r.otType}
                    </td>
                  )}
                  <td style={{ padding: '5px 10px', fontWeight: 500 }}>{r.shift}</td>
                  {dates.map(d => {
                    const count = countMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0;
                    return (
                      <td key={d} style={{
                        padding: '5px 10px', textAlign: 'center',
                        fontWeight: count > 0 ? 700 : 400,
                        color: count > 0 ? '#1e293b' : '#cbd5e1',
                        overflow: 'hidden',
                        animation: count > 0 && animKey > 0 ? `flashGlow 0.8s ease ${(i * 0.1 + dates.indexOf(d) * 0.15 + 1)}s` : 'none',
                        borderRadius: 4,
                      }}>
                        {count > 0 ? (
                          <SlotNumber
                            value={count}
                            delay={(i * 100 + dates.indexOf(d) * 150)}
                            animKey={animKey}
                          />
                        ) : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr style={{ borderTop: '2px solid #cbd5e1', background: '#f1f5f9' }}>
              <td colSpan={2} style={{ padding: '6px 10px', fontWeight: 700 }}>Total</td>
              {dates.map(d => {
                let total = 0;
                rows.forEach(r => { total += countMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0; });
                return <td key={d} style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700, color: '#1e293b' }}>{total > 0 ? total : ''}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* OT Garnered Table */}
      {(() => {
        const filledMap = new Map<string, number>();
        const releasedMap = new Map<string, number>();
        for (const s of slots) {
          const shift = deriveShift(s.otType, s.timeWindow, s.date, shifts);
          const key = `${s.otType}|${shift}|${s.date}`;
          if (s.status === 'Filled') filledMap.set(key, (filledMap.get(key) ?? 0) + 1);
          if (s.status === 'Released' || s.status === 'Filled') releasedMap.set(key, (releasedMap.get(key) ?? 0) + 1);
        }
        let lastOT2 = '';
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 6 }}>
              <strong style={{ fontSize: 14, color: '#166534' }}>OT Garnered (Picked Up)</strong>
              <button style={{ padding: '4px 10px', fontSize: 11, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 4, cursor: 'pointer' }}
                onClick={() => {
                  const headers = ['OT Type', 'Shift', ...dates.map(fmtDate)];
                  const csvRows = rows.map(r => [r.otType, r.shift, ...dates.map(d => String(filledMap.get(`${r.otType}|${r.shift}|${d}`) ?? ''))]);
                  downloadCSV(headers, csvRows, 'ot_garnered.csv');
                }}>⬇ Download CSV</button>
            </div>
            <div style={{ overflowX: 'auto', border: '1px solid #bbf7d0', borderRadius: 6 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, whiteSpace: 'nowrap' }}>
                <thead>
                  <tr style={{ background: '#f0fdf4' }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #86efac', fontWeight: 700 }}>OT Type</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #86efac', fontWeight: 700 }}>Shift</th>
                    {dates.map(d => <th key={d} style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '2px solid #86efac', fontWeight: 700 }}>{fmtDate(d)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const showOT = r.otType !== lastOT2;
                    if (showOT) lastOT2 = r.otType;
                    const rowSpan = showOT ? otTypeRowCounts.get(r.otType) ?? 1 : 0;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #dcfce7' }}>
                        {showOT && <td rowSpan={rowSpan} style={{ padding: '5px 10px', fontWeight: 600, background: '#f0fdf4', borderRight: '1px solid #dcfce7', verticalAlign: 'top' }}>{r.otType}</td>}
                        <td style={{ padding: '5px 10px', fontWeight: 500 }}>{r.shift}</td>
                        {dates.map(d => {
                          const count = filledMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0;
                          return <td key={d} style={{ padding: '5px 10px', textAlign: 'center', fontWeight: count > 0 ? 700 : 400, color: count > 0 ? '#166534' : '#cbd5e1' }}>{count > 0 ? count : ''}</td>;
                        })}
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: '2px solid #86efac', background: '#f0fdf4' }}>
                    <td colSpan={2} style={{ padding: '6px 10px', fontWeight: 700, color: '#166534' }}>Total</td>
                    {dates.map(d => {
                      let total = 0;
                      rows.forEach(r => { total += filledMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0; });
                      return <td key={d} style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700, color: '#166534' }}>{total > 0 ? total : ''}</td>;
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Fill Rate % Table */}
            {(() => {
              let lastOT3 = '';
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 6 }}>
                    <strong style={{ fontSize: 14, color: '#9333ea' }}>Fill Rate % by Type, Shift & Date</strong>
                    <button style={{ padding: '4px 10px', fontSize: 11, background: '#faf5ff', color: '#7c3aed', border: '1px solid #d8b4fe', borderRadius: 4, cursor: 'pointer' }}
                      onClick={() => {
                        const headers = ['OT Type', 'Shift', ...dates.map(fmtDate)];
                        const csvRows = rows.map(r => [r.otType, r.shift, ...dates.map(d => {
                          const filled = filledMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0;
                          const released = releasedMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0;
                          return released > 0 ? `${Math.round((filled / released) * 100)}%` : '';
                        })]);
                        downloadCSV(headers, csvRows, 'ot_fill_rate_detail.csv');
                      }}>⬇ Download CSV</button>
                  </div>
                  <div style={{ overflowX: 'auto', border: '1px solid #d8b4fe', borderRadius: 6 }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, whiteSpace: 'nowrap' }}>
                      <thead>
                        <tr style={{ background: '#faf5ff' }}>
                          <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #c084fc', fontWeight: 700 }}>OT Type</th>
                          <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #c084fc', fontWeight: 700 }}>Shift</th>
                          {dates.map(d => <th key={d} style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '2px solid #c084fc', fontWeight: 700 }}>{fmtDate(d)}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => {
                          const showOT = r.otType !== lastOT3;
                          if (showOT) lastOT3 = r.otType;
                          const rowSpan = showOT ? otTypeRowCounts.get(r.otType) ?? 1 : 0;
                          return (
                            <tr key={i} style={{ borderBottom: '1px solid #f3e8ff' }}>
                              {showOT && <td rowSpan={rowSpan} style={{ padding: '5px 10px', fontWeight: 600, background: '#faf5ff', borderRight: '1px solid #f3e8ff', verticalAlign: 'top' }}>{r.otType}</td>}
                              <td style={{ padding: '5px 10px', fontWeight: 500 }}>{r.shift}</td>
                              {dates.map(d => {
                                const filled = filledMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0;
                                const released = releasedMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0;
                                const rate = released > 0 ? Math.round((filled / released) * 100) : -1;
                                const color = rate < 0 ? '#cbd5e1' : rate >= 80 ? '#166534' : rate >= 50 ? '#ca8a04' : '#dc2626';
                                const bg = rate < 0 ? 'transparent' : rate >= 80 ? '#f0fdf4' : rate >= 50 ? '#fefce8' : '#fef2f2';
                                return <td key={d} style={{ padding: '5px 10px', textAlign: 'center', fontWeight: rate >= 0 ? 700 : 400, color, background: bg, borderRadius: 2 }}>{rate >= 0 ? `${rate}%` : ''}</td>;
                              })}
                            </tr>
                          );
                        })}
                        <tr style={{ borderTop: '2px solid #c084fc', background: '#faf5ff' }}>
                          <td colSpan={2} style={{ padding: '6px 10px', fontWeight: 700, color: '#7c3aed' }}>Total</td>
                          {dates.map(d => {
                            let totalFilled = 0, totalReleased = 0;
                            rows.forEach(r => {
                              totalFilled += filledMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0;
                              totalReleased += releasedMap.get(`${r.otType}|${r.shift}|${d}`) ?? 0;
                            });
                            const rate = totalReleased > 0 ? Math.round((totalFilled / totalReleased) * 100) : -1;
                            const color = rate < 0 ? '#cbd5e1' : rate >= 80 ? '#166534' : rate >= 50 ? '#ca8a04' : '#dc2626';
                            return <td key={d} style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700, color }}>{rate >= 0 ? `${rate}%` : ''}</td>;
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </>
        );
      })()}
    </div>
  );
}

export default function SlotManagement({ slots, shifts, programs, lobbies, heatmap, revised, onRefresh, initialProgram, initialLobby, initialWeek, onSelectionChange }: Props) {
  const [selectedProgram, setSelectedProgram] = useState(initialProgram || '');
  const [selectedLobby, setSelectedLobby] = useState(initialLobby || '');
  const [selectedWeek, setSelectedWeek] = useState(initialWeek || '');
  const [message, setMessage] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [loading, setLoading] = useState(false);
  const [generateCount, setGenerateCount] = useState(0);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [tolerance, setTolerance] = useState(-2);

  // Compute selected week's date range (Sunday to Saturday) from the selectedWeek key
  const weekDateRange = useMemo(() => {
    if (!selectedWeek) return null;
    // selectedWeek is a YYYY-MM-DD string representing the Sunday
    const sun = new Date(selectedWeek + 'T12:00:00');
    const sat = new Date(sun);
    sat.setDate(sat.getDate() + 6);
    const start = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}`;
    const end = `${sat.getFullYear()}-${String(sat.getMonth() + 1).padStart(2, '0')}-${String(sat.getDate()).padStart(2, '0')}`;
    return { start, end };
  }, [selectedWeek]);

  // Filter heatmap to selected week only
  const weekFilteredHeatmap = useMemo(() => {
    if (!heatmap?.length || !weekDateRange) return heatmap || [];
    return heatmap.filter(r => r.date >= weekDateRange.start && r.date <= weekDateRange.end);
  }, [heatmap, weekDateRange]);

  // Filter revised heatmap to selected week only
  const weekFilteredRevised = useMemo(() => {
    if (!revised?.length || !weekDateRange) return revised || [];
    return revised.filter(r => r.date >= weekDateRange.start && r.date <= weekDateRange.end);
  }, [revised, weekDateRange]);

  // Single shared OT demand computation — uses week-filtered heatmap
  const otDemand = useMemo(() => {
    if (!weekFilteredHeatmap?.length || !shifts?.length || !selectedProgram) {
      return { dates: [], rows: [], demandMap: new Map<string, number>(), adjustments: new Map<string, number>() } as OTDemandResult;
    }
    return computeOTDemand(weekFilteredHeatmap, shifts, selectedProgram, tolerance);
  }, [weekFilteredHeatmap, shifts, selectedProgram, tolerance]);

  // Apply the demand adjustments to the week-filtered heatmap
  const demandRevisedHeatmap = useMemo(() => {
    if (!weekFilteredHeatmap?.length || !selectedProgram) return [];
    const { adjustments } = otDemand;
    return weekFilteredHeatmap.map(r => {
      if (r.program !== selectedProgram) return r;
      const key = `${r.date}|${r.intervalStartTime}`;
      const adj = adjustments.get(key) ?? 0;
      if (adj > 0) return { ...r, overUnderValue: r.overUnderValue + adj };
      return r;
    });
  }, [weekFilteredHeatmap, selectedProgram, otDemand]);

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMessage(text); setMsgType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  // Filter lobbies by selected program (from roster data)
  const filteredLobbies = useMemo(() => {
    if (!selectedProgram) return lobbies;
    const programLobbies = new Set<string>();
    for (const s of shifts) {
      if (s.program === selectedProgram && s.lobby) {
        programLobbies.add(s.lobby);
      }
    }
    return [...programLobbies].sort();
  }, [selectedProgram, shifts, lobbies]);

  // Reset lobby when program changes and lobby is no longer valid
  const handleProgramChange = (prog: string) => {
    setSelectedProgram(prog);
    setHasGenerated(false);
    let newLobby = selectedLobby;
    if (selectedLobby) {
      const newLobbies = prog
        ? [...new Set(shifts.filter(s => s.program === prog && s.lobby).map(s => s.lobby))].sort()
        : lobbies;
      if (!newLobbies.includes(selectedLobby)) {
        setSelectedLobby('');
        newLobby = '';
      }
    }
    if (onSelectionChange) onSelectionChange(prog, newLobby, selectedWeek);
  };

  /**
   * Excel WEEKNUM(date, 1) — week starts on Sunday.
   * Jan 1 is always in week 1. Week increments each Sunday.
   */
  function excelWeekNum(d: Date): number {
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const jan1Day = jan1.getDay(); // 0=Sun
    const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;
    return Math.ceil((dayOfYear + jan1Day) / 7);
  }

  // Compute available weeks from all data sources (Sunday-Saturday)
  const weeks = useMemo(() => {
    const allDates = new Set<string>();
    slots.forEach((s) => allDates.add(s.date));
    shifts.forEach((s) => allDates.add(s.date));
    if (heatmap) heatmap.forEach((r) => allDates.add(r.date));

    const weekMap = new Map<string, { start: Date; end: Date; label: string; weekNum: number }>();
    for (const dateStr of allDates) {
      const d = new Date(dateStr + 'T12:00:00');
      const day = d.getDay();
      const sun = new Date(d);
      sun.setDate(sun.getDate() - day);
      const sat = new Date(sun);
      sat.setDate(sat.getDate() + 6);

      const y = sun.getFullYear();
      const m = String(sun.getMonth() + 1).padStart(2, '0');
      const dd = String(sun.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${dd}`;

      if (!weekMap.has(key)) {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const label = `${sun.getDate()}-${months[sun.getMonth()]} to ${sat.getDate()}-${months[sat.getMonth()]}`;
        const wn = excelWeekNum(sun);
        weekMap.set(key, { start: sun, end: sat, label, weekNum: wn });
      }
    }

    return [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => ({ key, ...val }));
  }, [slots, shifts, heatmap]);

  // Check if selected week is in the past
  const isSelectedWeekPast = useMemo(() => {
    if (!selectedWeek) return false;
    const w = weeks.find((w) => w.key === selectedWeek);
    if (!w) return false;
    const now = new Date();
    const day = now.getDay();
    const currentSun = new Date(now);
    currentSun.setDate(currentSun.getDate() - day);
    currentSun.setHours(0, 0, 0, 0);
    return w.start < currentSun;
  }, [selectedWeek, weeks]);

  const handleGenerate = async () => {
    if (!selectedProgram) return;
    setLoading(true);
    try {
      const res = await api.generateSlots(selectedProgram, tolerance);
      showMsg(`Generated ${res.generated} slots for ${selectedProgram}`, 'success');
      setGenerateCount((c) => c + 1);
      setHasGenerated(true);
      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Generation failed', 'error');
    } finally { setLoading(false); }
  };

  const handleRelease = async (ids: string[]) => {
    try {
      await api.releaseSlots(ids);
      showMsg(`Released ${ids.length} slots`, 'success');
      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Release failed', 'error');
    }
  };

  const handleCancel = async (id: string) => {
    try { await api.cancelSlot(id); if (onRefresh) onRefresh(); }
    catch (err: unknown) { showMsg(err instanceof Error ? err.message : 'Cancel failed', 'error'); }
  };

  const filteredSlots = useMemo(() => {
    let s = slots;
    if (selectedProgram) s = s.filter((x) => x.program === selectedProgram);
    if (selectedLobby) s = s.filter((x) => x.lobby === selectedLobby);
    if (selectedWeek) {
      const w = weeks.find((w) => w.key === selectedWeek);
      if (w) {
        const start = `${w.start.getFullYear()}-${String(w.start.getMonth() + 1).padStart(2, '0')}-${String(w.start.getDate()).padStart(2, '0')}`;
        const end = `${w.end.getFullYear()}-${String(w.end.getMonth() + 1).padStart(2, '0')}-${String(w.end.getDate()).padStart(2, '0')}`;
        s = s.filter((x) => x.date >= start && x.date <= end);
      }
    }
    return s;
  }, [slots, selectedProgram, selectedLobby, selectedWeek, weeks]);

  return (
    <div className={styles.container}>
      <div className={styles.generateRow}>
        <select value={selectedProgram} onChange={(e) => handleProgramChange(e.target.value)}>
          <option value="">Select Program</option>
          {programs.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {filteredLobbies.length > 0 && (
          <select value={selectedLobby} onChange={(e) => { setSelectedLobby(e.target.value); setHasGenerated(false); if (onSelectionChange) onSelectionChange(selectedProgram, e.target.value, selectedWeek); }}>
            <option value="">All Lobbies</option>
            {filteredLobbies.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <select value={selectedWeek} onChange={(e) => { setSelectedWeek(e.target.value); setHasGenerated(false); if (onSelectionChange) onSelectionChange(selectedProgram, selectedLobby, e.target.value); }}>
          <option value="">Select Week</option>
          {weeks.map((w) => (
            <option key={w.key} value={w.key}>Week {w.weekNum} ({w.label})</option>
          ))}
        </select>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={handleGenerate}
          disabled={!selectedProgram || loading || isSelectedWeekPast}
          title={isSelectedWeekPast ? 'Cannot generate OT for past weeks' : ''}
        >
          {loading ? 'Generating…' : isSelectedWeekPast ? 'Past Week (Read Only)' : 'Auto-Generate OT Slots'}
        </button>
      </div>

      {message && (
        <div className={`${styles.message} ${msgType === 'success' ? styles.success : styles.error}`}>{message}</div>
      )}

      {!selectedWeek ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8', fontSize: '0.9rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
          <p style={{ margin: 0 }}>Select a week to view OT slots, or upload heatmap & roster and auto-generate for the current week.</p>
        </div>
      ) : (
        <>
          {hasGenerated && selectedProgram && weekFilteredHeatmap && weekFilteredHeatmap.length > 0 && <OTDemandTable dates={otDemand.dates} rows={otDemand.rows} demandMap={otDemand.demandMap} animKey={generateCount} />}
          {hasGenerated && filteredSlots.length > 0 && <OTPivotTable slots={filteredSlots} shifts={shifts} animKey={generateCount} allDates={weekFilteredHeatmap ? [...new Set(weekFilteredHeatmap.map(r => r.date))] : undefined} />}
          {hasGenerated && <SlotList slots={filteredSlots} shifts={shifts} onRelease={handleRelease} onCancel={handleCancel} />}
          {hasGenerated && weekFilteredHeatmap && weekFilteredHeatmap.length > 0 && (
            <div style={{ marginTop: '1.5rem', background: '#fff', borderRadius: 8, padding: '0.75rem', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.3rem', color: '#1e293b' }}>Heatmap Comparison</div>
              <ToleranceConfig value={tolerance} onChange={setTolerance} />
              <FillRateHeatmap original={weekFilteredHeatmap} revised={weekFilteredRevised} demandRevised={demandRevisedHeatmap} programs={programs} lobbies={lobbies} selectedProgram={selectedProgram} selectedLobby={selectedLobby} />
            </div>
          )}
          {!hasGenerated && (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.85rem' }}>
              Click "Auto-Generate OT Slots" to view OT analysis and heatmaps.
            </div>
          )}
        </>
      )}
    </div>
  );
}

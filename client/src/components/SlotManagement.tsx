import { useState, useMemo, useRef } from 'react';
import type { OTSlot, ShiftEntry, HeatmapRow } from '../types';
import * as api from '../api/httpClient';
import { downloadCSV } from '../modules/csvDownload';
import SlotList from './SlotList';
import SlotNumber from './SlotNumber';
import styles from './SlotManagement.module.css';

interface Props {
  slots: OTSlot[];
  shifts: ShiftEntry[];
  heatmap?: HeatmapRow[];
  programs: string[];
  lobbies: string[];
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

/** Pivot table: OT Type × Shift rows, Date columns, count values */
function OTPivotTable({ slots, shifts, animKey }: { slots: OTSlot[]; shifts: ShiftEntry[]; animKey: number }) {
  const dates = useMemo(() => [...new Set(slots.map(s => s.date))].sort(), [slots]);
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
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SlotManagement({ slots, shifts, programs, lobbies, heatmap }: Props) {
  const [selectedProgram, setSelectedProgram] = useState('');
  const [selectedLobby, setSelectedLobby] = useState('');
  const [selectedWeek, setSelectedWeek] = useState('');
  const [message, setMessage] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [loading, setLoading] = useState(false);
  const [generateCount, setGenerateCount] = useState(0);

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
    if (selectedLobby) {
      const newLobbies = prog
        ? [...new Set(shifts.filter(s => s.program === prog && s.lobby).map(s => s.lobby))].sort()
        : lobbies;
      if (!newLobbies.includes(selectedLobby)) {
        setSelectedLobby('');
      }
    }
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
      const res = await api.generateSlots(selectedProgram);
      showMsg(`Generated ${res.generated} slots for ${selectedProgram}`, 'success');
      setGenerateCount((c) => c + 1);
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Generation failed', 'error');
    } finally { setLoading(false); }
  };

  const handleRelease = async (ids: string[]) => {
    try {
      await api.releaseSlots(ids);
      showMsg(`Released ${ids.length} slots`, 'success');
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Release failed', 'error');
    }
  };

  const handleCancel = async (id: string) => {
    try { await api.cancelSlot(id); }
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
          <select value={selectedLobby} onChange={(e) => setSelectedLobby(e.target.value)}>
            <option value="">All Lobbies</option>
            {filteredLobbies.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <select value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)}>
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
          {filteredSlots.length > 0 && <OTPivotTable slots={filteredSlots} shifts={shifts} animKey={generateCount} />}
          <SlotList slots={filteredSlots} shifts={shifts} onRelease={handleRelease} onCancel={handleCancel} />
          {filteredSlots.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.85rem' }}>
              No OT slots for this selection.
            </div>
          )}
        </>
      )}
    </div>
  );
}

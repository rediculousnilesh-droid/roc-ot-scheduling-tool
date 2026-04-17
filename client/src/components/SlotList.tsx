import { useMemo } from 'react';
import type { OTSlot, ShiftEntry } from '../types';
import { downloadCSV } from '../modules/csvDownload';
import styles from './SlotList.module.css';

interface SlotGroup {
  otType: string;
  shift: string;
  date: string;
  total: number;
  created: number;
  released: number;
  filled: number;
  slotIds: string[];
  createdIds: string[];
}

function deriveShiftName(otType: string, timeWindow: string, date: string, shifts: ShiftEntry[]): string {
  if (otType === 'Full Day OT') return timeWindow;
  const match = timeWindow.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!match) return timeWindow;
  const otStart = match[1];
  const otEnd = match[2];
  for (const s of shifts) {
    if (s.date !== date || s.isWeeklyOff || !s.shiftStart || !s.shiftEnd) continue;
    if (otType.includes('Pre Shift') && otEnd === s.shiftStart) return `${s.shiftStart}-${s.shiftEnd}`;
    if (otType.includes('Post Shift') && otStart === s.shiftEnd) return `${s.shiftStart}-${s.shiftEnd}`;
  }
  return timeWindow;
}

function fmtDate(d: string): string {
  const p = d.split('-');
  if (p.length !== 3) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(p[2])}-${months[parseInt(p[1]) - 1]}`;
}

interface Props {
  slots: OTSlot[];
  shifts: ShiftEntry[];
  onRelease?: (ids: string[]) => void;
  onCancel?: (id: string) => void;
  readOnly?: boolean;
}

export default function SlotList({ slots, shifts, onRelease, onCancel, readOnly = false }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, SlotGroup>();
    for (const slot of slots) {
      const shiftName = deriveShiftName(slot.otType, slot.timeWindow, slot.date, shifts);
      const key = `${slot.otType}|${shiftName}|${slot.date}`;
      const g = map.get(key);
      if (g) {
        g.total++;
        if (slot.status === 'Created') { g.created++; g.createdIds.push(slot.id); }
        if (slot.status === 'Released') g.released++;
        if (slot.status === 'Filled') g.filled++;
        g.slotIds.push(slot.id);
      } else {
        map.set(key, {
          otType: slot.otType, shift: shiftName, date: slot.date, total: 1,
          created: slot.status === 'Created' ? 1 : 0,
          released: slot.status === 'Released' ? 1 : 0,
          filled: slot.status === 'Filled' ? 1 : 0,
          slotIds: [slot.id], createdIds: slot.status === 'Created' ? [slot.id] : [],
        });
      }
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.otType.localeCompare(b.otType) || a.shift.localeCompare(b.shift));
  }, [slots, shifts]);

  const totalCreated = groups.reduce((s, g) => s + g.created, 0);
  const totalReleased = groups.reduce((s, g) => s + g.released, 0);
  const totalFilled = groups.reduce((s, g) => s + g.filled, 0);

  if (!slots.length) return <p style={{ fontSize: 13, color: '#94a3b8' }}>No OT slots yet.</p>;

  return (
    <div className={styles.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: '#64748b' }}>
          {slots.length} total — Created: {totalCreated} | Released: {totalReleased} | Filled: {totalFilled}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ padding: '4px 10px', fontSize: 11, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 4, cursor: 'pointer' }}
            onClick={() => {
              const headers = ['OT Type', 'Shift', 'Date', 'Total', 'Created', 'Released', 'Filled'];
              const rows = groups.map(g => [g.otType, g.shift, g.date, String(g.total), String(g.created), String(g.released), String(g.filled)]);
              downloadCSV(headers, rows, 'ot_slots_summary.csv');
            }}>⬇ CSV</button>
          {!readOnly && totalCreated > 0 && onRelease && (
            <button style={{ padding: '4px 10px', fontSize: 11, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              onClick={() => onRelease(slots.filter(s => s.status === 'Created').map(s => s.id))}>
              Release All ({totalCreated})
            </button>
          )}
        </div>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>OT Type</th>
            <th>Shift</th>
            <th>Date</th>
            <th>Total</th>
            <th>Created</th>
            <th>Released</th>
            <th>Filled</th>
            {!readOnly && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={i}>
              <td>{g.otType}</td>
              <td>{g.shift}</td>
              <td>{fmtDate(g.date)}</td>
              <td style={{ fontWeight: 700 }}>{g.total}</td>
              <td style={{ color: g.created > 0 ? '#d97706' : '#cbd5e1' }}>{g.created || '—'}</td>
              <td style={{ color: g.released > 0 ? '#2563eb' : '#cbd5e1' }}>{g.released || '—'}</td>
              <td style={{ color: g.filled > 0 ? '#16a34a' : '#cbd5e1' }}>{g.filled || '—'}</td>
              {!readOnly && (
                <td>
                  {g.created > 0 && onRelease && (
                    <button style={{ padding: '2px 8px', fontSize: 11, background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd', borderRadius: 3, cursor: 'pointer', marginRight: 4 }}
                      onClick={() => onRelease(g.createdIds)}>Release ({g.created})</button>
                  )}
                  {(g.created > 0 || g.released > 0) && onCancel && (
                    <button style={{ padding: '2px 8px', fontSize: 11, background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 3, cursor: 'pointer' }}
                      onClick={() => g.slotIds.filter(id => { const s = slots.find(sl => sl.id === id); return s && (s.status === 'Created' || s.status === 'Released'); }).forEach(id => onCancel(id))}>Cancel</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

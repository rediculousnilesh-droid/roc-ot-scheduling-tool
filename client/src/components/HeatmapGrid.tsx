import { useState, useMemo } from 'react';
import type { HeatmapRow } from '../types';
import styles from './HeatmapGrid.module.css';

interface Props {
  data: HeatmapRow[];
  title?: string;
  programs?: string[];
  lobbies?: string[];
}

function getCellColor(value: number): string {
  if (value > 1) return '#d4edda';   // light green
  if (value < -1) return '#f8d7da';  // light red
  return '#fff3cd';                   // light yellow
}

function getTextColor(value: number): string {
  if (value > 1) return '#155724';
  if (value < -1) return '#721c24';
  return '#856404';
}

function fmtDate(d: string): string {
  const p = d.split('-');
  if (p.length !== 3) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(p[2])}-${months[parseInt(p[1]) - 1]}`;
}

export default function HeatmapGrid({ data, title, programs, lobbies }: Props) {
  const [selectedProgram, setSelectedProgram] = useState('');
  const [selectedLobby, setSelectedLobby] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const allPrograms = useMemo(() => {
    if (programs?.length) return programs;
    return [...new Set(data.map((r) => r.program))].sort();
  }, [data, programs]);

  const allLobbies = useMemo(() => {
    if (lobbies?.length) return lobbies;
    return [...new Set(data.filter((r) => r.lobby).map((r) => r.lobby))].sort();
  }, [data, lobbies]);

  const filtered = useMemo(() => {
    let rows = data;
    if (selectedProgram) rows = rows.filter((r) => r.program === selectedProgram);
    if (selectedLobby) rows = rows.filter((r) => r.lobby === selectedLobby);
    if (startDate) rows = rows.filter((r) => r.date >= startDate);
    if (endDate) rows = rows.filter((r) => r.date <= endDate);
    return rows;
  }, [data, selectedProgram, selectedLobby, startDate, endDate]);

  const { dates, intervals, grid } = useMemo(() => {
    const dateSet = new Set<string>();
    const intervalSet = new Set<string>();
    filtered.forEach((r) => { dateSet.add(r.date); intervalSet.add(r.intervalStartTime); });
    const dates = [...dateSet].sort();
    const intervals = [...intervalSet].sort();
    const grid = new Map<string, number>();
    filtered.forEach((r) => {
      const key = `${r.intervalStartTime}|${r.date}`;
      grid.set(key, (grid.get(key) || 0) + r.overUnderValue);
    });
    return { dates, intervals, grid };
  }, [filtered]);

  if (!data.length) return null;

  return (
    <div>
      {title && <div className={styles.title}>{title}</div>}
      <div className={styles.filters}>
        <select value={selectedProgram} onChange={(e) => setSelectedProgram(e.target.value)}>
          <option value="">All Programs</option>
          {allPrograms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {allLobbies.length > 0 && (
          <select value={selectedLobby} onChange={(e) => setSelectedLobby(e.target.value)}>
            <option value="">All Lobbies</option>
            {allLobbies.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className={styles.container}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.intervalHeader}>Interval</th>
              {dates.map((d) => <th key={d}>{fmtDate(d)}</th>)}
            </tr>
          </thead>
          <tbody>
            {intervals.map((interval) => (
              <tr key={interval}>
                <td className={styles.intervalHeader}>{interval}</td>
                {dates.map((date) => {
                  const val = grid.get(`${interval}|${date}`);
                  if (val === undefined) return <td key={date} className={styles.cell}></td>;
                  return (
                    <td key={date} className={styles.cell}
                      style={{ backgroundColor: getCellColor(val), color: getTextColor(val) }}
                      onMouseEnter={(e) => setTooltip({ x: e.clientX + 10, y: e.clientY + 10, text: `Date: ${date} | Interval: ${interval} | Value: ${val}` })}
                      onMouseMove={(e) => { if (tooltip) setTooltip({ ...tooltip, x: e.clientX + 10, y: e.clientY + 10 }); }}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      {Math.round(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tooltip && <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.text}</div>}
    </div>
  );
}

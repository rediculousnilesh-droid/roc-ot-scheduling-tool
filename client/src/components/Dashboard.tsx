import { useRef, useState, useMemo } from 'react';
import type { Chart as ChartJS } from 'chart.js';
import type { OTSlot, HeatmapRow, AllFillRates, OTRecommendation, ShiftEntry } from '../types';
import SummaryCards from './SummaryCards';
import FillRateBarChart from './FillRateBarChart';
import ManagerBarChart from './ManagerBarChart';
import TrendLineChart from './TrendLineChart';
import DataTable from './DataTable';
import ExportControls from './ExportControls';
import FillRateHeatmap from './FillRateHeatmap';
import ThresholdConfig from './ThresholdConfig';
import styles from './Dashboard.module.css';

interface Props {
  slots: OTSlot[];
  heatmap: HeatmapRow[];
  revised: HeatmapRow[];
  fillRates: AllFillRates | null;
  recommendations: OTRecommendation[];
  programs: string[];
  managers: string[];
  lobbies: string[];
  shifts?: ShiftEntry[];
}

/** Get the Sunday that starts the week containing the given date */
function getWeekStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  return d;
}

function fmtShort(d: Date): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()}-${months[d.getMonth()]}`;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Excel WEEKNUM(date, 1) — week starts on Sunday */
function excelWeekNum(d: Date): number {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const jan1Day = jan1.getDay();
  const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;
  return Math.ceil((dayOfYear + jan1Day) / 7);
}

export default function Dashboard({
  slots,
  heatmap,
  revised,
  fillRates,
  recommendations,
  programs,
  managers,
  lobbies,
  shifts,
}: Props) {
  const [filterProgram, setFilterProgram] = useState('');
  const [filterManager, setFilterManager] = useState('');
  const [filterLobby, setFilterLobby] = useState('');
  const [filterOtType, setFilterOtType] = useState('');
  const [selectedWeek, setSelectedWeek] = useState('');
  const [threshold, setThreshold] = useState(-2);
  const [dashAnimKey, setDashAnimKey] = useState(0);

  const fillRateBarRef = useRef<ChartJS<'bar'> | null>(null);
  const managerBarRef = useRef<ChartJS<'bar'> | null>(null);
  const trendLineRef = useRef<ChartJS<'line'> | null>(null);

  // Filter lobbies by selected program
  const filteredLobbies = useMemo(() => {
    if (!filterProgram) return lobbies;
    const programLobbies = new Set<string>();
    heatmap.forEach((r) => { if (r.program === filterProgram && r.lobby) programLobbies.add(r.lobby); });
    slots.forEach((s) => { if (s.program === filterProgram && s.lobby) programLobbies.add(s.lobby); });
    return [...programLobbies].sort();
  }, [filterProgram, heatmap, slots, lobbies]);

  const handleProgramChange = (prog: string) => {
    setFilterProgram(prog);
    if (filterLobby) {
      const newLobbies = prog
        ? [...new Set([
            ...heatmap.filter(r => r.program === prog && r.lobby).map(r => r.lobby),
            ...slots.filter(s => s.program === prog && s.lobby).map(s => s.lobby),
          ])].sort()
        : lobbies;
      if (!newLobbies.includes(filterLobby)) setFilterLobby('');
    }
  };

  // Trigger animation when week changes
  const prevWeekRef = useRef('');
  useMemo(() => {
    if (selectedWeek && selectedWeek !== prevWeekRef.current) {
      setDashAnimKey((k) => k + 1);
    }
    prevWeekRef.current = selectedWeek;
  }, [selectedWeek]);

  // Compute available weeks from all data dates (Sunday-Saturday)
  const weeks = useMemo(() => {
    const allDates = new Set<string>();
    heatmap.forEach((r) => allDates.add(r.date));
    slots.forEach((s) => allDates.add(s.date));
    recommendations.forEach((r) => allDates.add(r.date));

    const weekMap = new Map<string, { start: Date; end: Date; label: string }>();
    for (const dateStr of allDates) {
      const sun = getWeekStart(dateStr);
      const sat = new Date(sun);
      sat.setDate(sat.getDate() + 6);
      const key = toISO(sun);
      if (!weekMap.has(key)) {
        weekMap.set(key, {
          start: sun,
          end: sat,
          label: `${fmtShort(sun)} to ${fmtShort(sat)}`,
        });
      }
    }

    const sorted = [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => ({ key, ...val, weekNum: excelWeekNum(val.start) }));
    return sorted;
  }, [heatmap, slots, recommendations]);

  // Derive start/end dates from selected week
  const { startDate, endDate } = useMemo(() => {
    if (!selectedWeek) return { startDate: '', endDate: '' };
    const w = weeks.find((w) => w.key === selectedWeek);
    if (!w) return { startDate: '', endDate: '' };
    return { startDate: toISO(w.start), endDate: toISO(w.end) };
  }, [selectedWeek, weeks]);

  const filteredSlots = useMemo(() => {
    let s = slots;
    if (filterProgram) s = s.filter((x) => x.program === filterProgram);
    if (filterLobby) s = s.filter((x) => x.lobby === filterLobby);
    if (filterOtType) s = s.filter((x) => x.otType === filterOtType);
    if (startDate) s = s.filter((x) => x.date >= startDate);
    if (endDate) s = s.filter((x) => x.date <= endDate);
    return s;
  }, [slots, filterProgram, filterLobby, filterOtType, startDate, endDate]);

  const filteredRecs = useMemo(() => {
    let r = recommendations;
    if (filterProgram) r = r.filter((x) => x.program === filterProgram);
    if (filterLobby) r = r.filter((x) => x.lobby === filterLobby);
    if (filterManager) r = r.filter((x) => x.manager === filterManager);
    if (filterOtType) r = r.filter((x) => x.otType === filterOtType);
    if (startDate) r = r.filter((x) => x.date >= startDate);
    if (endDate) r = r.filter((x) => x.date <= endDate);
    return r;
  }, [recommendations, filterProgram, filterLobby, filterManager, filterOtType, startDate, endDate]);

  const otTypes = ['1hr Pre Shift OT', '1hr Post Shift OT', '2hr Pre Shift OT', '2hr Post Shift OT', 'Full Day OT'];

  return (
    <div className={styles.container}>
      <div className={styles.filterBar}>
        <select value={filterProgram} onChange={(e) => handleProgramChange(e.target.value)}>
          <option value="">All Programs</option>
          {programs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {filteredLobbies.length > 0 && (
          <select value={filterLobby} onChange={(e) => setFilterLobby(e.target.value)}>
            <option value="">All Lobbies</option>
            {filteredLobbies.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <select value={filterManager} onChange={(e) => setFilterManager(e.target.value)}>
          <option value="">All Managers</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filterOtType} onChange={(e) => setFilterOtType(e.target.value)}>
          <option value="">All OT Types</option>
          {otTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)}>
          <option value="">Select Week</option>
          {weeks.map((w) => (
            <option key={w.key} value={w.key}>Week {w.weekNum} ({w.label})</option>
          ))}
        </select>
      </div>

      {!selectedWeek ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#94a3b8', fontSize: '0.9rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📊</div>
          <p style={{ margin: 0 }}>Select a week to view dashboard data and reports.</p>
        </div>
      ) : (
        <>
          <SummaryCards slots={filteredSlots} fillRates={fillRates} animKey={dashAnimKey} />

          <ExportControls
            slots={filteredSlots}
            recommendations={filteredRecs}
            fillRates={fillRates}
            heatmap={heatmap}
            revised={revised}
            shifts={shifts}
            chartRefs={{
              fillRateBar: fillRateBarRef.current,
              managerBar: managerBarRef.current,
              trendLine: trendLineRef.current,
            }}
          />

          <div className={styles.chartGrid}>
            <FillRateBarChart fillRates={fillRates} chartRef={fillRateBarRef} />
            <ManagerBarChart fillRates={fillRates} chartRef={managerBarRef} />
            <TrendLineChart fillRates={fillRates} chartRef={trendLineRef} />
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>OT Pivot Table</div>
            <DataTable data={filteredRecs} />
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Heatmap Comparison</div>
            <ThresholdConfig value={threshold} onChange={setThreshold} />
            <FillRateHeatmap
              original={heatmap}
              revised={revised}
              programs={programs}
              lobbies={lobbies}
              threshold={threshold}
            />
          </div>
        </>
      )}
    </div>
  );
}

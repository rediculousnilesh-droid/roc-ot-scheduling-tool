import { useMemo, useState } from 'react';
import type { OTSlot, AllFillRates } from '../types';
import SummaryCards from './SummaryCards';
import FillRateBarChart from './FillRateBarChart';
import { downloadCSV } from '../modules/csvDownload';
import styles from './Dashboard.module.css';

interface Props {
  slots: OTSlot[];
  fillRates: AllFillRates | null;
  managerPrograms: string[];
  managerName: string;
}

export default function ManagerDashboard({ slots, fillRates, managerPrograms, managerName }: Props) {
  const [filterProgram, setFilterProgram] = useState('');
  const [filterOtType, setFilterOtType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const scopedSlots = useMemo(() => {
    let s = slots.filter((x) => managerPrograms.includes(x.program));
    if (filterProgram) s = s.filter((x) => x.program === filterProgram);
    if (filterOtType) s = s.filter((x) => x.otType === filterOtType);
    if (startDate) s = s.filter((x) => x.date >= startDate);
    if (endDate) s = s.filter((x) => x.date <= endDate);
    return s;
  }, [slots, managerPrograms, filterProgram, filterOtType, startDate, endDate]);

  // Build scoped fill rates for manager's programs only
  const scopedFillRates = useMemo((): AllFillRates | null => {
    if (!fillRates) return null;
    const byProgram: Record<string, { totalReleased: number; totalFilled: number; fillRate: number | null }> = {};
    managerPrograms.forEach((p) => {
      if (fillRates.byProgram[p]) byProgram[p] = fillRates.byProgram[p];
    });
    const byManager: Record<string, { totalReleased: number; totalFilled: number; fillRate: number | null }> = {};
    if (fillRates.byManager[managerName]) byManager[managerName] = fillRates.byManager[managerName];

    // Compute overall from scoped slots
    const releasedOrFilled = scopedSlots.filter((s) => s.status === 'Released' || s.status === 'Filled');
    const filled = scopedSlots.filter((s) => s.status === 'Filled');
    const overall = {
      totalReleased: releasedOrFilled.length,
      totalFilled: filled.length,
      fillRate: releasedOrFilled.length > 0
        ? Math.round((filled.length / releasedOrFilled.length) * 10000) / 100
        : null,
    };

    return {
      ...fillRates,
      overall,
      byProgram,
      byManager,
    };
  }, [fillRates, managerPrograms, managerName, scopedSlots]);

  // Per-agent breakdown
  const agentBreakdown = useMemo(() => {
    const map = new Map<string, { filled: number; released: number; total: number }>();
    scopedSlots.forEach((s) => {
      const agent = s.assignedAgentName || s.filledByAgentName || 'Unknown';
      if (!map.has(agent)) map.set(agent, { filled: 0, released: 0, total: 0 });
      const entry = map.get(agent)!;
      entry.total++;
      if (s.status === 'Filled') entry.filled++;
      if (s.status === 'Released') entry.released++;
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [scopedSlots]);

  const exportAgentBreakdown = () => {
    const headers = ['Agent', 'Filled', 'Released', 'Total'];
    const rows = agentBreakdown.map(([agent, data]) => [
      agent, String(data.filled), String(data.released), String(data.total),
    ]);
    downloadCSV(headers, rows, 'agent_breakdown.csv');
  };

  const exportPickupReport = () => {
    const headers = ['Agent', 'Program', 'Lobby', 'Date', 'OT Type', 'OT Time Window', 'Status', 'Pickup Date/Time', 'Opted for OT'];
    const rows: string[][] = [];
    for (const s of scopedSlots) {
      if (s.status === 'Cancelled') continue;
      const agent = s.filledByAgentName || s.assignedAgentName || '';
      const pickupTime = s.filledAt ? new Date(s.filledAt).toLocaleString() : '';
      const opted = s.status === 'Filled' ? 'Yes' : 'No';
      rows.push([agent, s.program, s.lobby, s.date, s.otType, s.timeWindow, s.status, pickupTime, opted]);
    }
    rows.sort((a, b) => a[0].localeCompare(b[0]) || a[3].localeCompare(b[3]));
    downloadCSV(headers, rows, 'ot_pickup_report.csv');
  };

  const otTypes = ['1hr Pre Shift OT', '1hr Post Shift OT', '2hr Pre Shift OT', '2hr Post Shift OT', 'Full Day OT'];

  return (
    <div className={styles.container}>
      <div className={styles.filterBar}>
        <select value={filterProgram} onChange={(e) => setFilterProgram(e.target.value)}>
          <option value="">All Programs</option>
          {managerPrograms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterOtType} onChange={(e) => setFilterOtType(e.target.value)}>
          <option value="">All OT Types</option>
          {otTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>

      <SummaryCards slots={scopedSlots} fillRates={scopedFillRates} />

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#fff', cursor: 'pointer', fontWeight: 500, color: '#475569' }} onClick={exportPickupReport}>📥 OT Pickup Report</button>
        <button style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#fff', cursor: 'pointer', fontWeight: 500, color: '#475569' }} onClick={exportAgentBreakdown}>📥 Agent Breakdown</button>
      </div>

      <div className={styles.chartGrid}>
        <FillRateBarChart fillRates={scopedFillRates} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Per-Agent Breakdown
          <button
            style={{ marginLeft: '1rem', padding: '2px 8px', fontSize: '0.75rem', border: '1px solid #ccc', borderRadius: '3px', background: '#fff', cursor: 'pointer' }}
            onClick={exportAgentBreakdown}
          >
            📥 CSV
          </button>
        </div>
        <div style={{ overflow: 'auto', maxHeight: 300, border: '1px solid #ddd', borderRadius: 4 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #ddd', padding: '4px 8px', background: '#f5f5f5', textAlign: 'left' }}>Agent</th>
                <th style={{ border: '1px solid #ddd', padding: '4px 8px', background: '#f5f5f5', textAlign: 'right' }}>Filled</th>
                <th style={{ border: '1px solid #ddd', padding: '4px 8px', background: '#f5f5f5', textAlign: 'right' }}>Released</th>
                <th style={{ border: '1px solid #ddd', padding: '4px 8px', background: '#f5f5f5', textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {agentBreakdown.map(([agent, data]) => (
                <tr key={agent}>
                  <td style={{ border: '1px solid #ddd', padding: '4px 8px' }}>{agent}</td>
                  <td style={{ border: '1px solid #ddd', padding: '4px 8px', textAlign: 'right' }}>{data.filled}</td>
                  <td style={{ border: '1px solid #ddd', padding: '4px 8px', textAlign: 'right' }}>{data.released}</td>
                  <td style={{ border: '1px solid #ddd', padding: '4px 8px', textAlign: 'right' }}>{data.total}</td>
                </tr>
              ))}
              {agentBreakdown.length === 0 && (
                <tr><td colSpan={4} style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'center', color: '#888' }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

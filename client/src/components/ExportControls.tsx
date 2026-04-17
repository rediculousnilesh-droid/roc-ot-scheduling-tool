import type { OTSlot, HeatmapRow, OTRecommendation, AllFillRates } from '../types';
import { downloadCSV, exportChartAsPNG } from '../modules/csvDownload';
import styles from './ExportControls.module.css';

interface Props {
  slots: OTSlot[];
  recommendations: OTRecommendation[];
  fillRates: AllFillRates | null;
  heatmap?: HeatmapRow[];
  revised?: HeatmapRow[];
  chartRefs?: {
    fillRateBar?: { toBase64Image: () => string } | null;
    managerBar?: { toBase64Image: () => string } | null;
    trendLine?: { toBase64Image: () => string } | null;
  };
}

export default function ExportControls({ slots, recommendations, fillRates, heatmap, revised, chartRefs }: Props) {
  const exportPivot = () => {
    const headers = ['Date', 'Program', 'Lobby', 'Agent', 'Manager', 'Shift', 'OT Type', 'Time Window', 'Deficit Block'];
    const rows = recommendations.map((r) => [
      r.date, r.program, r.lobby, r.agent, r.manager, r.shift, r.otType, r.otTimeWindow, r.deficitBlock,
    ]);
    downloadCSV(headers, rows, 'ot_pivot_table.csv');
  };

  const exportSlots = () => {
    const headers = ['ID', 'OT Type', 'Date', 'Program', 'Lobby', 'Time Window', 'Status', 'Assigned Agent', 'Filled By'];
    const rows = slots.map((s) => [
      s.id, s.otType, s.date, s.program, s.lobby, s.timeWindow, s.status,
      s.assignedAgentName || '', s.filledByAgentName || '',
    ]);
    downloadCSV(headers, rows, 'ot_slots.csv');
  };

  const exportFillRates = () => {
    if (!fillRates) return;
    const headers = ['Group', 'Total Released', 'Total Filled', 'Fill Rate %'];
    const rows: string[][] = [];
    rows.push(['Overall', String(fillRates.overall.totalReleased), String(fillRates.overall.totalFilled), fillRates.overall.fillRate != null ? String(fillRates.overall.fillRate) : 'N/A']);
    Object.entries(fillRates.byProgram).forEach(([k, v]) => {
      rows.push([`Program: ${k}`, String(v.totalReleased), String(v.totalFilled), v.fillRate != null ? String(v.fillRate) : 'N/A']);
    });
    Object.entries(fillRates.byManager).forEach(([k, v]) => {
      rows.push([`Manager: ${k}`, String(v.totalReleased), String(v.totalFilled), v.fillRate != null ? String(v.fillRate) : 'N/A']);
    });
    Object.entries(fillRates.byDate).forEach(([k, v]) => {
      rows.push([`Date: ${k}`, String(v.totalReleased), String(v.totalFilled), v.fillRate != null ? String(v.fillRate) : 'N/A']);
    });
    Object.entries(fillRates.byWeek).forEach(([k, v]) => {
      rows.push([`Week: ${k}`, String(v.totalReleased), String(v.totalFilled), v.fillRate != null ? String(v.fillRate) : 'N/A']);
    });
    downloadCSV(headers, rows, 'fill_rates.csv');
  };

  const exportHeatmap = (data: HeatmapRow[] | undefined, filename: string) => {
    if (!data?.length) return;
    const headers = ['Date', 'Program', 'Lobby', 'Interval_Start_Time', 'Over_Under_Value'];
    const rows = data.map((r) => [r.date, r.program, r.lobby, r.intervalStartTime, String(r.overUnderValue)]);
    downloadCSV(headers, rows, filename);
  };

  return (
    <div className={styles.container}>
      <button className={styles.btn} onClick={exportPivot}>📥 Pivot Table</button>
      <button className={styles.btn} onClick={exportSlots}>📥 Slots</button>
      <button className={styles.btn} onClick={exportFillRates}>📥 Fill Rates</button>
      {heatmap && heatmap.length > 0 && (
        <button className={styles.btn} onClick={() => exportHeatmap(heatmap, 'heatmap_original.csv')}>📥 Heatmap (Before OT)</button>
      )}
      {revised && revised.length > 0 && (
        <button className={styles.btn} onClick={() => exportHeatmap(revised, 'heatmap_revised.csv')}>📥 Heatmap (After OT)</button>
      )}
      {chartRefs?.fillRateBar && (
        <button className={styles.btn} onClick={() => exportChartAsPNG(chartRefs.fillRateBar, 'fill_rate_by_program.png')}>
          📷 Program Chart
        </button>
      )}
      {chartRefs?.managerBar && (
        <button className={styles.btn} onClick={() => exportChartAsPNG(chartRefs.managerBar, 'fill_rate_by_manager.png')}>
          📷 Manager Chart
        </button>
      )}
      {chartRefs?.trendLine && (
        <button className={styles.btn} onClick={() => exportChartAsPNG(chartRefs.trendLine, 'fill_rate_trend.png')}>
          📷 Trend Chart
        </button>
      )}
    </div>
  );
}

import { Router } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import type { HeatmapRow } from '../types.js';
import { parseHeatmapCSV } from '../modules/heatmapParser.js';
import { saveHeatmapData, loadHeatmapData, saveSessionMeta, loadSessionMeta, loadRevisedHeatmap, saveSlots, saveRecommendations, saveRevisedHeatmap } from '../storage/jsonFileStore.js';

/** Get the Sunday that starts the current week */
function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const sun = new Date(now);
  sun.setDate(sun.getDate() - day);
  const y = sun.getFullYear();
  const m = String(sun.getMonth() + 1).padStart(2, '0');
  const d = String(sun.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Merges new heatmap rows into existing data.
 * Rows are keyed by date+program+lobby+interval. New rows overwrite existing ones with the same key.
 */
function mergeHeatmapData(existing: HeatmapRow[], incoming: HeatmapRow[]): HeatmapRow[] {
  const map = new Map<string, HeatmapRow>();
  for (const row of existing) {
    const key = `${row.date}|${row.program}|${row.lobby}|${row.intervalStartTime}`;
    map.set(key, row);
  }
  for (const row of incoming) {
    const key = `${row.date}|${row.program}|${row.lobby}|${row.intervalStartTime}`;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.program.localeCompare(b.program) || a.intervalStartTime.localeCompare(b.intervalStartTime)
  );
}

export function createHeatmapRouter(io: SocketIOServer): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const csvString = req.body?.csv;
    if (!csvString || typeof csvString !== 'string') {
      res.status(400).json({ error: 'Please upload a valid CSV file.' });
      return;
    }

    if (csvString.trim().length === 0) {
      res.status(400).json({ error: 'The uploaded file contains no data rows.' });
      return;
    }

    const result = parseHeatmapCSV(csvString);

    if (result.errors.length > 0 && result.valid.length === 0) {
      res.status(400).json({ errors: result.errors });
      return;
    }

    if (result.valid.length === 0) {
      res.status(400).json({ error: 'The uploaded file contains no data rows.' });
      return;
    }

    // Check for past-week data
    const weekStart = getCurrentWeekStart();
    const pastRows = result.valid.filter((r) => r.date < weekStart);
    const futureRows = result.valid.filter((r) => r.date >= weekStart);

    if (futureRows.length === 0) {
      res.status(400).json({
        error: `All ${pastRows.length} rows contain dates before the current week (${weekStart}). Only current and future week data can be uploaded.`,
      });
      return;
    }

    // Merge only current/future week data
    const existing = loadHeatmapData();
    const merged = mergeHeatmapData(existing, futureRows);
    saveHeatmapData(merged);

    // Clear generated slots/recommendations since heatmap data changed
    saveSlots([]);
    saveRecommendations([]);
    saveRevisedHeatmap([]);

    // Update session meta
    const meta = loadSessionMeta() ?? {
      createdAt: new Date().toISOString(),
      lastUploadAt: null,
      heatmapUploaded: false,
      rosterUploaded: false,
    };
    meta.heatmapUploaded = true;
    meta.lastUploadAt = new Date().toISOString();
    saveSessionMeta(meta);

    const revised = loadRevisedHeatmap();
    io.emit('heatmap:updated', { heatmap: merged, revised });

    res.json({ success: true, rowCount: futureRows.length, totalRows: merged.length, skippedPastRows: pastRows.length, errors: result.errors });
  });

  router.get('/', (_req, res) => {
    const heatmap = loadHeatmapData();
    const revised = loadRevisedHeatmap();
    res.json({ heatmap, revised });
  });

  return router;
}

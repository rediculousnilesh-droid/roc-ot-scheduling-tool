import { Router } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import type { ShiftRoster, ShiftEntry } from '../types.js';
import { parseShiftCSV } from '../modules/shiftParser.js';
import { saveRosterData, loadRosterData, saveSessionMeta, loadSessionMeta, saveSlots, saveRecommendations, saveRevisedHeatmap } from '../storage/jsonFileStore.js';

/** Get the Sunday that starts the current week */
function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const sun = new Date(now);
  sun.setDate(sun.getDate() - day);
  const y = sun.getFullYear();
  const m = String(sun.getMonth() + 1).padStart(2, '0');
  const d = String(sun.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Merges new roster entries into existing data.
 * Entries are keyed by agent+date. New entries overwrite existing ones with the same key.
 */
function mergeRosterData(existing: ShiftRoster | null, incoming: ShiftRoster): ShiftRoster {
  if (!existing) return incoming;

  const map = new Map<string, ShiftEntry>();
  for (const e of existing.entries) {
    const key = `${e.agent.toLowerCase()}|${e.date}`;
    map.set(key, e);
  }
  for (const e of incoming.entries) {
    const key = `${e.agent.toLowerCase()}|${e.date}`;
    map.set(key, e);
  }

  const entries = [...map.values()].sort((a, b) =>
    a.agent.localeCompare(b.agent) || a.date.localeCompare(b.date)
  );

  const agents = [...new Set(entries.map((e) => e.agent))].sort();
  const managers = [...new Set(entries.filter((e) => e.manager).map((e) => e.manager))].sort();
  const programs = [...new Set(entries.filter((e) => e.program).map((e) => e.program))].sort();
  const lobbies = [...new Set(entries.filter((e) => e.lobby).map((e) => e.lobby))].sort();
  const dates = [...new Set(entries.map((e) => e.date))].sort();

  return { entries, agents, managers, programs, lobbies, dates };
}

export function createRosterRouter(io: SocketIOServer): Router {
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

    const { roster, errors } = parseShiftCSV(csvString);

    if (errors.length > 0 && roster.entries.length === 0) {
      res.status(400).json({ errors });
      return;
    }

    // Check for past-week data
    const weekStart = getCurrentWeekStart();
    const pastEntries = roster.entries.filter((e) => e.date < weekStart);
    const futureEntries = roster.entries.filter((e) => e.date >= weekStart);

    if (futureEntries.length === 0) {
      res.status(400).json({
        error: `All ${pastEntries.length} entries contain dates before the current week (${weekStart}). Only current and future week data can be uploaded.`,
      });
      return;
    }

    // Build a roster from only current/future entries
    const filteredRoster: ShiftRoster = {
      entries: futureEntries,
      agents: [...new Set(futureEntries.map((e) => e.agent))].sort(),
      managers: [...new Set(futureEntries.filter((e) => e.manager).map((e) => e.manager))].sort(),
      programs: [...new Set(futureEntries.filter((e) => e.program).map((e) => e.program))].sort(),
      lobbies: [...new Set(futureEntries.filter((e) => e.lobby).map((e) => e.lobby))].sort(),
      dates: [...new Set(futureEntries.map((e) => e.date))].sort(),
    };

    // Merge with existing data
    const existing = loadRosterData();
    const merged = mergeRosterData(existing, filteredRoster);
    saveRosterData(merged);

    // Clear generated slots/recommendations since roster data changed
    saveSlots([]);
    saveRecommendations([]);
    saveRevisedHeatmap([]);

    const meta = loadSessionMeta() ?? {
      createdAt: new Date().toISOString(),
      lastUploadAt: null,
      heatmapUploaded: false,
      rosterUploaded: false,
    };
    meta.rosterUploaded = true;
    meta.lastUploadAt = new Date().toISOString();
    saveSessionMeta(meta);

    io.emit('roster:updated', {
      agents: merged.agents,
      managers: merged.managers,
      programs: merged.programs,
      lobbies: merged.lobbies,
    });

    res.json({ success: true, entryCount: futureEntries.length, totalEntries: merged.entries.length, skippedPastEntries: pastEntries.length, errors });
  });

  router.get('/', (_req, res) => {
    const roster = loadRosterData();
    if (!roster) {
      res.json({ agents: [], managers: [], programs: [], lobbies: [], entries: [] });
      return;
    }
    res.json({
      agents: roster.agents,
      managers: roster.managers,
      programs: roster.programs,
      lobbies: roster.lobbies,
      entries: roster.entries,
    });
  });

  return router;
}

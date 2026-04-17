import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { HeatmapRow, ShiftRoster, OTSlot, SessionMeta, OTRecommendation } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(name: string): string {
  return path.join(DATA_DIR, name);
}

function writeJSON(name: string, data: unknown): void {
  ensureDataDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf-8');
}

function readJSON<T>(name: string, fallback: T): T {
  ensureDataDir();
  const fp = filePath(name);
  if (!fs.existsSync(fp)) return fallback;
  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveHeatmapData(data: HeatmapRow[]): void {
  writeJSON('heatmap.json', data);
}

export function loadHeatmapData(): HeatmapRow[] {
  return readJSON<HeatmapRow[]>('heatmap.json', []);
}

export function saveRosterData(roster: ShiftRoster): void {
  writeJSON('roster.json', roster);
}

export function loadRosterData(): ShiftRoster | null {
  return readJSON<ShiftRoster | null>('roster.json', null);
}

export function saveSlots(slots: OTSlot[]): void {
  writeJSON('slots.json', slots);
}

export function loadSlots(): OTSlot[] {
  return readJSON<OTSlot[]>('slots.json', []);
}

export function saveSessionMeta(meta: SessionMeta): void {
  writeJSON('session.json', meta);
}

export function loadSessionMeta(): SessionMeta | null {
  return readJSON<SessionMeta | null>('session.json', null);
}

export function saveRevisedHeatmap(data: HeatmapRow[]): void {
  writeJSON('revised_heatmap.json', data);
}

export function loadRevisedHeatmap(): HeatmapRow[] {
  return readJSON<HeatmapRow[]>('revised_heatmap.json', []);
}

export function saveRecommendations(recs: OTRecommendation[]): void {
  writeJSON('recommendations.json', recs);
}

export function loadRecommendations(): OTRecommendation[] {
  return readJSON<OTRecommendation[]>('recommendations.json', []);
}

export function clearAll(): void {
  ensureDataDir();
  const files = fs.readdirSync(DATA_DIR);
  for (const file of files) {
    if (file.endsWith('.json')) {
      fs.unlinkSync(path.join(DATA_DIR, file));
    }
  }
}

/**
 * Clears only current-week data, preserving historical data.
 * Week starts on Sunday.
 */
export function clearCurrentWeek(): void {
  const now = new Date();
  const day = now.getDay();
  const sun = new Date(now);
  sun.setDate(sun.getDate() - day);
  const weekStart = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}`;

  // Filter heatmap — keep rows before current week
  const heatmap = loadHeatmapData();
  const historicalHeatmap = heatmap.filter((r) => r.date < weekStart);
  saveHeatmapData(historicalHeatmap);

  // Filter roster — keep entries before current week
  const roster = loadRosterData();
  if (roster) {
    const historicalEntries = roster.entries.filter((e) => e.date < weekStart);
    if (historicalEntries.length > 0) {
      const agents = [...new Set(historicalEntries.map((e) => e.agent))].sort();
      const managers = [...new Set(historicalEntries.filter((e) => e.manager).map((e) => e.manager))].sort();
      const programs = [...new Set(historicalEntries.filter((e) => e.program).map((e) => e.program))].sort();
      const lobbies = [...new Set(historicalEntries.filter((e) => e.lobby).map((e) => e.lobby))].sort();
      const dates = [...new Set(historicalEntries.map((e) => e.date))].sort();
      saveRosterData({ entries: historicalEntries, agents, managers, programs, lobbies, dates });
    } else {
      // No historical entries — remove roster file
      const fp = path.join(DATA_DIR, 'roster.json');
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  }

  // Filter slots — keep slots before current week
  const slots = loadSlots();
  const historicalSlots = slots.filter((s) => s.date < weekStart);
  saveSlots(historicalSlots);

  // Filter recommendations — keep recs before current week
  const recs = loadRecommendations();
  const historicalRecs = recs.filter((r) => r.date < weekStart);
  saveRecommendations(historicalRecs);

  // Filter revised heatmap — keep rows before current week
  const revised = loadRevisedHeatmap();
  const historicalRevised = revised.filter((r) => r.date < weekStart);
  saveRevisedHeatmap(historicalRevised);

  // Reset session meta
  const fp = path.join(DATA_DIR, 'session.json');
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

/** Exported for testing */
export { DATA_DIR };

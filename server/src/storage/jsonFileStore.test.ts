import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  saveHeatmapData, loadHeatmapData,
  saveRosterData, loadRosterData,
  saveSlots, loadSlots,
  saveSessionMeta, loadSessionMeta,
  saveRevisedHeatmap, loadRevisedHeatmap,
  saveRecommendations, loadRecommendations,
  clearAll, DATA_DIR,
} from './jsonFileStore.js';
import type { HeatmapRow, ShiftRoster, OTSlot, SessionMeta, OTRecommendation } from '../types.js';

// Use a test-specific data directory
const TEST_DATA_DIR = DATA_DIR;

function cleanTestData() {
  if (fs.existsSync(TEST_DATA_DIR)) {
    const files = fs.readdirSync(TEST_DATA_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(TEST_DATA_DIR, file));
      }
    }
  }
}

describe('jsonFileStore', () => {
  beforeEach(() => cleanTestData());
  afterEach(() => cleanTestData());

  it('should save and load heatmap data', () => {
    const data: HeatmapRow[] = [
      { date: '2026-04-15', program: 'ProgramA', lobby: '', intervalStartTime: '07:00', overUnderValue: -3 },
      { date: '2026-04-15', program: 'ProgramA', lobby: '', intervalStartTime: '07:30', overUnderValue: 2 },
    ];
    saveHeatmapData(data);
    const loaded = loadHeatmapData();
    expect(loaded).toEqual(data);
  });

  it('should return empty array when no heatmap data exists', () => {
    expect(loadHeatmapData()).toEqual([]);
  });

  it('should save and load roster data', () => {
    const roster: ShiftRoster = {
      entries: [{ agent: 'A1', program: 'P1', lobby: '', manager: 'M1', date: '2026-04-15', shiftStart: '07:00', shiftEnd: '16:00', isWeeklyOff: false }],
      agents: ['A1'],
      managers: ['M1'],
      programs: ['P1'],
      lobbies: [],
      dates: ['2026-04-15'],
    };
    saveRosterData(roster);
    expect(loadRosterData()).toEqual(roster);
  });

  it('should return null when no roster data exists', () => {
    expect(loadRosterData()).toBeNull();
  });

  it('should save and load slots', () => {
    const slots: OTSlot[] = [{
      id: 'slot_1', otType: '1hr Pre Shift OT', date: '2026-04-15', program: 'P1', lobby: '',
      timeWindow: '06:00-07:00', status: 'Created', assignedAgentId: 'A1', assignedAgentName: 'A1',
      createdAt: '2026-01-01T00:00:00Z', releasedAt: null, filledAt: null,
      filledByAgentId: null, filledByAgentName: null, returnedAt: null,
    }];
    saveSlots(slots);
    expect(loadSlots()).toEqual(slots);
  });

  it('should save and load session meta', () => {
    const meta: SessionMeta = {
      createdAt: '2026-01-01T00:00:00Z',
      lastUploadAt: '2026-01-01T01:00:00Z',
      heatmapUploaded: true,
      rosterUploaded: false,
    };
    saveSessionMeta(meta);
    expect(loadSessionMeta()).toEqual(meta);
  });

  it('should save and load revised heatmap', () => {
    const data: HeatmapRow[] = [
      { date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '07:00', overUnderValue: -2 },
    ];
    saveRevisedHeatmap(data);
    expect(loadRevisedHeatmap()).toEqual(data);
  });

  it('should save and load recommendations', () => {
    const recs: OTRecommendation[] = [{
      date: '2026-04-15', program: 'P1', lobby: '', agent: 'A1', manager: 'M1',
      shift: '07:00-16:00', otType: '1hr Pre Shift OT', otTimeWindow: '06:00-07:00',
      deficitBlock: '05:00-07:00',
    }];
    saveRecommendations(recs);
    expect(loadRecommendations()).toEqual(recs);
  });

  it('should clear all data', () => {
    saveHeatmapData([{ date: '2026-04-15', program: 'P1', lobby: '', intervalStartTime: '07:00', overUnderValue: -3 }]);
    saveSlots([]);
    clearAll();
    expect(loadHeatmapData()).toEqual([]);
    expect(loadSlots()).toEqual([]);
    expect(loadRosterData()).toBeNull();
  });
});

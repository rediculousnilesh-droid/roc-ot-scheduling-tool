import { Router } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import type { GenerateRequest } from '../types.js';
import { generateAutoSlots } from '../modules/autoSlotGenerator.js';
import { computeRevisedHeatmap } from '../modules/revisedHeatmap.js';
import { calculateAllFillRates } from '../modules/fillRateCalculator.js';
import {
  loadHeatmapData, loadRosterData, loadSlots,
  saveSlots, saveRevisedHeatmap, saveRecommendations, loadRecommendations,
} from '../storage/jsonFileStore.js';

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

export function createGenerateRouter(io: SocketIOServer): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const body = req.body as GenerateRequest;
    const { program } = body;

    if (!program) {
      res.status(400).json({ error: 'Program is required.' });
      return;
    }

    const heatmapData = loadHeatmapData();
    if (heatmapData.length === 0) {
      res.status(400).json({ error: 'Heatmap data must be uploaded before generating slots.' });
      return;
    }

    const roster = loadRosterData();
    if (!roster) {
      res.status(400).json({ error: 'Shift roster must be uploaded before generating slots.' });
      return;
    }

    // Only generate for current/future week data
    const weekStart = getCurrentWeekStart();
    const currentHeatmap = heatmapData.filter((r) => r.date >= weekStart);
    if (currentHeatmap.length === 0) {
      res.status(400).json({ error: 'No heatmap data available for the current or future weeks. Cannot generate OT slots for past weeks.' });
      return;
    }

    const programShifts = roster.entries.filter((e) => e.program === program && e.date >= weekStart);
    if (programShifts.length === 0) {
      res.status(400).json({ error: `No shift roster data for ${program} in the current or future weeks.` });
      return;
    }

    const result = generateAutoSlots(programShifts, currentHeatmap, -2, program);

    // Remove existing slots and recommendations for this program, then add new ones
    const existingSlots = loadSlots();
    const otherSlots = existingSlots.filter((s) => s.program !== program);
    const allSlots = [...otherSlots, ...result.slots];
    saveSlots(allSlots);

    // Remove existing recommendations for this program, then add new ones
    const existingRecs = loadRecommendations();
    const otherRecs = existingRecs.filter((r) => r.program !== program);
    const allRecs = [...otherRecs, ...result.recommendations];
    saveRecommendations(allRecs);

    // Compute revised heatmap
    const revised = computeRevisedHeatmap(heatmapData, allRecs);
    saveRevisedHeatmap(revised);

    // Calculate fill rates
    const fillRates = calculateAllFillRates(allSlots, roster);

    io.emit('slots:updated', { slots: allSlots, fillRates, recommendations: allRecs });
    io.emit('heatmap:updated', { heatmap: heatmapData, revised });

    res.json({
      success: true,
      generated: result.slots.length,
      summary: result.summary,
      deficitBlocks: result.deficitBlocks,
    });
  });

  return router;
}

import { Router } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { clearCurrentWeek, loadSessionMeta, loadHeatmapData, loadRosterData, loadSlots, loadRevisedHeatmap } from '../storage/jsonFileStore.js';

export function createSessionRouter(io: SocketIOServer): Router {
  const router = Router();

  router.post('/clear', (_req, res) => {
    clearCurrentWeek();

    // Broadcast updated data (historical only)
    const heatmap = loadHeatmapData();
    const revised = loadRevisedHeatmap();
    const roster = loadRosterData();
    const slots = loadSlots();

    io.emit('heatmap:updated', { heatmap, revised });
    if (roster) {
      io.emit('roster:updated', {
        agents: roster.agents,
        managers: roster.managers,
        programs: roster.programs,
        lobbies: roster.lobbies,
      });
    }
    io.emit('slots:updated', { slots, fillRates: null, recommendations: [] });
    io.emit('session:cleared', {});

    res.json({ success: true, message: 'Current week data cleared. Historical data preserved.' });
  });

  router.get('/status', (_req, res) => {
    const meta = loadSessionMeta();
    const connectedClients = io.engine?.clientsCount ?? 0;
    res.json({
      hasData: meta !== null,
      heatmapUploaded: meta?.heatmapUploaded ?? false,
      rosterUploaded: meta?.rosterUploaded ?? false,
      connectedClients,
    });
  });

  return router;
}

import { Router } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import type { SlotReleaseRequest, SlotPickupRequest, SlotReturnRequest, SlotCancelRequest } from '../types.js';
import { releaseSlots, cancelSlot, pickupSlot, returnSlot } from '../modules/slotManager.js';
import { validateAgentPickup, getEligibleSlotsForAgent } from '../modules/accessControl.js';
import { calculateAllFillRates } from '../modules/fillRateCalculator.js';
import { serializeSlotsToCSV } from '../modules/exportService.js';
import { loadSlots, saveSlots, loadRosterData, loadRecommendations } from '../storage/jsonFileStore.js';

export function createSlotsRouter(io: SocketIOServer): Router {
  const router = Router();

  function broadcastUpdate() {
    const slots = loadSlots();
    const roster = loadRosterData();
    const recs = loadRecommendations();
    const fillRates = roster ? calculateAllFillRates(slots, roster) : null;
    io.emit('slots:updated', { slots, fillRates, recommendations: recs });
  }

  router.get('/', (req, res) => {
    const slots = loadSlots();
    const role = req.query.role as string | undefined;
    const agentId = req.query.agentId as string | undefined;

    if (role === 'agent' && agentId) {
      const roster = loadRosterData();
      if (!roster) {
        res.json({ slots: [] });
        return;
      }
      const eligible = getEligibleSlotsForAgent(slots, agentId, roster);
      res.json({ slots: eligible });
      return;
    }

    res.json({ slots });
  });

  router.post('/release', (req, res) => {
    const body = req.body as SlotReleaseRequest;
    let { slotIds } = body;

    if (!slotIds || !Array.isArray(slotIds)) {
      res.status(400).json({ error: 'slotIds array is required.' });
      return;
    }

    let slots = loadSlots();

    // Handle "release all" — release all Created slots
    if (slotIds.length === 1 && slotIds[0] === 'all') {
      slotIds = slots.filter((s) => s.status === 'Created').map((s) => s.id);
    }

    try {
      slots = releaseSlots(slots, slotIds);
      saveSlots(slots);
      broadcastUpdate();
      res.json({ success: true, released: slotIds.length });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/cancel', (req, res) => {
    const body = req.body as SlotCancelRequest;
    const { slotId } = body;

    if (!slotId) {
      res.status(400).json({ error: 'slotId is required.' });
      return;
    }

    try {
      let slots = loadSlots();
      slots = cancelSlot(slots, slotId);
      saveSlots(slots);
      broadcastUpdate();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/pickup', (req, res) => {
    const body = req.body as SlotPickupRequest & { agentId: string; agentName: string };
    const { slotId, agentId, agentName } = body;

    if (!slotId || !agentId) {
      res.status(400).json({ error: 'slotId and agentId are required.' });
      return;
    }

    const roster = loadRosterData();
    if (!roster) {
      res.status(400).json({ error: 'No roster data available.' });
      return;
    }

    let slots = loadSlots();
    const validation = validateAgentPickup(slots, slotId, agentId, roster);
    if (!validation.valid) {
      const statusCode = validation.error?.includes('no longer available') ? 409 :
        validation.error?.includes('program mismatch') ? 403 : 400;
      res.status(statusCode).json({ error: validation.error });
      return;
    }

    try {
      slots = pickupSlot(slots, slotId, agentId, agentName || agentId);
      saveSlots(slots);
      broadcastUpdate();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/pickup-all', (req, res) => {
    const { agentId, agentName } = req.body as { agentId: string; agentName: string };

    if (!agentId) {
      res.status(400).json({ error: 'agentId is required.' });
      return;
    }

    const roster = loadRosterData();
    if (!roster) {
      res.status(400).json({ error: 'No roster data available.' });
      return;
    }

    let slots = loadSlots();
    const eligible = getEligibleSlotsForAgent(slots, agentId, roster);
    let pickedUp = 0;
    const skipped: string[] = [];

    // Sort eligible slots: Pre/Post shift first (by date), then Full Day OT
    const sorted = [...eligible].sort((a, b) => {
      const aFull = a.otType === 'Full Day OT' ? 1 : 0;
      const bFull = b.otType === 'Full Day OT' ? 1 : 0;
      if (aFull !== bFull) return aFull - bFull;
      return a.date.localeCompare(b.date);
    });

    for (const slot of sorted) {
      // Re-validate each time since picking up one slot may affect eligibility for the next
      const validation = validateAgentPickup(slots, slot.id, agentId, roster);
      if (validation.valid) {
        try {
          slots = pickupSlot(slots, slot.id, agentId, agentName || agentId);
          pickedUp++;
        } catch {
          skipped.push(`${slot.date} ${slot.otType}: pickup failed`);
        }
      } else {
        skipped.push(`${slot.date} ${slot.otType}: ${validation.error}`);
      }
    }

    if (pickedUp > 0) {
      saveSlots(slots);
      broadcastUpdate();
    }

    res.json({ success: true, pickedUp, skipped });
  });

  router.post('/return', (req, res) => {
    const body = req.body as SlotReturnRequest;
    const { slotId } = body;

    if (!slotId) {
      res.status(400).json({ error: 'slotId is required.' });
      return;
    }

    try {
      let slots = loadSlots();
      slots = returnSlot(slots, slotId);
      saveSlots(slots);
      broadcastUpdate();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/export', (_req, res) => {
    const slots = loadSlots();
    const roster = loadRosterData();
    if (!roster) {
      res.status(400).json({ error: 'No roster data available.' });
      return;
    }
    const csv = serializeSlotsToCSV(slots, roster);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=ot_slots_export.csv');
    res.send(csv);
  });

  return router;
}

import { Router } from 'express';
import { calculateAllFillRates } from '../modules/fillRateCalculator.js';
import { loadSlots, loadRosterData } from '../storage/jsonFileStore.js';

const router = Router();

router.get('/', (_req, res) => {
  const slots = loadSlots();
  const roster = loadRosterData();
  if (!roster) {
    res.json({
      overall: { totalReleased: 0, totalFilled: 0, fillRate: null },
      byProgram: {},
      byManager: {},
      byDate: {},
      byWeek: {},
      byProgramWeek: {},
      byManagerWeek: {},
    });
    return;
  }
  const fillRates = calculateAllFillRates(slots, roster);
  res.json(fillRates);
});

export default router;

import { Router } from 'express';
import os from 'os';
import type { LoginRequest, LoginResponse } from '../types.js';
import { loadRosterData } from '../storage/jsonFileStore.js';
import { v4 as uuidv4 } from 'uuid';
import { getManagerPrograms } from '../modules/accessControl.js';

function getSystemUsername(): string {
  const username = os.userInfo().username || '';
  const clean = username.includes('\\') ? username.split('\\').pop()! : username;
  return clean.toLowerCase();
}

const router = Router();

router.post('/login', (req, res) => {
  const body = req.body as LoginRequest;
  const { role, agentId, managerName } = body;

  if (!role) {
    res.status(400).json({ success: false, error: 'Role is required.' });
    return;
  }

  if (role === 'wfm') {
    const response: LoginResponse = {
      success: true,
      token: uuidv4(),
      user: { role: 'wfm', name: 'WFM User' },
    };
    res.json(response);
    return;
  }

  const roster = loadRosterData();
  if (!roster) {
    res.status(400).json({ success: false, error: 'No shift roster has been uploaded yet. Please contact WFM.' });
    return;
  }

  if (role === 'agent') {
    // Enforce system username — ignore whatever agentId was sent
    const systemUser = getSystemUsername();
    const loginId = systemUser || (agentId?.toLowerCase() ?? '');

    if (!loginId) {
      res.status(400).json({ success: false, error: 'Agent ID is required.' });
      return;
    }

    const agentEntries = roster.entries.filter((e) => e.agent.toLowerCase() === loginId);
    if (agentEntries.length === 0) {
      res.status(401).json({ success: false, error: `Agent "${loginId}" not found in the roster. Your system login is "${systemUser}". Please ensure the roster has your login ID as the Agent name.` });
      return;
    }

    const first = agentEntries[0];
    const response: LoginResponse = {
      success: true,
      token: uuidv4(),
      user: {
        role: 'agent',
        name: first.agent,
        agentId: first.agent,
        program: first.program,
        manager: first.manager,
      },
    };
    res.json(response);
    return;
  }

  if (role === 'manager') {
    if (!managerName) {
      res.status(400).json({ success: false, error: 'Manager name is required.' });
      return;
    }

    if (!roster.managers.includes(managerName)) {
      res.status(401).json({ success: false, error: 'Manager not found in the uploaded shift roster.' });
      return;
    }

    const programs = getManagerPrograms(managerName, roster);
    const response: LoginResponse = {
      success: true,
      token: uuidv4(),
      user: {
        role: 'manager',
        name: managerName,
        programs,
      },
    };
    res.json(response);
    return;
  }

  res.status(400).json({ success: false, error: 'Invalid role.' });
});

router.get('/managers', (_req, res) => {
  const roster = loadRosterData();
  if (!roster) {
    res.json({ managers: [] });
    return;
  }
  res.json({ managers: roster.managers });
});

export default router;

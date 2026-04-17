import Papa from 'papaparse';
import type { RawShiftRow, ShiftEntry, ShiftRoster, ValidationError } from '../types.js';

/**
 * Normalizes date headers like "4/15/2026" or "04/15/2026" to "YYYY-MM-DD".
 */
export function normalizeDateHeader(header: string): string | null {
  const trimmed = header.trim();

  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, '0');
    const d = slashMatch[2].padStart(2, '0');
    return `${slashMatch[3]}-${m}-${d}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  return null;
}

/** Non-working day keywords */
const NON_WORKING_KEYWORDS = [
  'WO', 'W/O', 'OFF', 'WEEKOFF', 'WEEK OFF',
  'LEAVE', 'MTL', 'PTL', 'LONG LEAVE', 'LL',
  'CL', 'SL', 'PL', 'EL', 'ML', 'AL',
  'ABSENT', 'ABS', 'NA', 'N/A', 'HOLIDAY',
  'TRAINING', 'TRG',
];

/**
 * Checks if a cell value is a non-working keyword.
 */
export function isNonWorkingKeyword(value: string): boolean {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return false;
  return NON_WORKING_KEYWORDS.some(
    (kw) => trimmed === kw || trimmed.startsWith(kw + ' ') || trimmed.endsWith(' ' + kw)
  );
}

/**
 * Parses a shift time like "07:00-16:00" into start/end.
 */
export function parseShiftTime(value: string): { start: string; end: string } | null {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;

  if (isNonWorkingKeyword(trimmed)) return null;

  const match = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(trimmed);
  if (!match) return null;

  const normalize = (t: string) => {
    const parts = t.split(':');
    return parts[0].padStart(2, '0') + ':' + parts[1];
  };

  return { start: normalize(match[1]), end: normalize(match[2]) };
}

/**
 * Parses a shift roster CSV string.
 */
export function parseShiftCSV(csvString: string): { roster: ShiftRoster; errors: ValidationError[] } {
  const results = Papa.parse<RawShiftRow>(csvString, {
    header: true,
    skipEmptyLines: true,
  });

  const rows = results.data;
  const errors: ValidationError[] = [];
  const entries: ShiftEntry[] = [];

  if (rows.length === 0) {
    return { roster: { entries: [], agents: [], managers: [], programs: [], lobbies: [], dates: [] }, errors: [] };
  }

  const headers = Object.keys(rows[0]);
  const agentCol = headers.find((h) => h.trim().toLowerCase() === 'agent');
  const managerCol = headers.find((h) => h.trim().toLowerCase() === 'manager');
  const programCol = headers.find((h) => h.trim().toLowerCase() === 'program');
  const lobbyCol = headers.find((h) => h.trim().toLowerCase() === 'lobby');

  if (!agentCol) errors.push({ row: 0, field: 'Agent', message: 'Missing required column: Agent' });
  if (!programCol) errors.push({ row: 0, field: 'Program', message: 'Missing required column: Program' });
  if (!managerCol) errors.push({ row: 0, field: 'Manager', message: 'Missing required column: Manager' });
  if (errors.length > 0) {
    return { roster: { entries: [], agents: [], managers: [], programs: [], lobbies: [], dates: [] }, errors };
  }

  const dateColumns: { header: string; normalized: string }[] = [];
  for (const h of headers) {
    const lower = h.trim().toLowerCase();
    if (lower === 'agent' || lower === 'manager' || lower === 'program' || lower === 'lobby') continue;
    const normalized = normalizeDateHeader(h);
    if (normalized) {
      dateColumns.push({ header: h, normalized });
    }
  }

  if (dateColumns.length === 0) {
    errors.push({ row: 0, field: 'dates', message: 'No valid date columns found' });
    return { roster: { entries: [], agents: [], managers: [], programs: [], lobbies: [], dates: [] }, errors };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;
    const agent = row[agentCol!]?.trim() ?? '';
    const manager = row[managerCol!]?.trim() ?? '';
    const program = row[programCol!]?.trim() ?? '';
    const lobby = lobbyCol ? (row[lobbyCol]?.trim() ?? '') : '';

    if (!agent) {
      errors.push({ row: rowNum, field: 'Agent', message: `Row ${rowNum}: Agent is required` });
      continue;
    }

    for (const dc of dateColumns) {
      const cellValue = row[dc.header]?.trim() ?? '';
      if (!cellValue) continue;

      const shift = parseShiftTime(cellValue);
      entries.push({
        agent,
        program,
        lobby,
        manager,
        date: dc.normalized,
        shiftStart: shift?.start ?? '',
        shiftEnd: shift?.end ?? '',
        isWeeklyOff: shift === null,
      });
    }
  }

  const agents = [...new Set(entries.map((e) => e.agent))].sort();
  const managers = [...new Set(entries.filter((e) => e.manager).map((e) => e.manager))].sort();
  const shiftPrograms = [...new Set(entries.filter((e) => e.program).map((e) => e.program))].sort();
  const lobbies = [...new Set(entries.filter((e) => e.lobby).map((e) => e.lobby))].sort();
  const dates = [...new Set(dateColumns.map((d) => d.normalized))].sort();

  return { roster: { entries, agents, managers, programs: shiftPrograms, lobbies, dates }, errors };
}

import Papa from 'papaparse';
import type { RawShiftRow, ShiftEntry, ShiftRoster, ValidationError } from '../types.js';

/**
 * Normalizes date headers like "4/15/2026", "04/15/2026", "31-May-26", "1-Jun-26" to "YYYY-MM-DD".
 */
export function normalizeDateHeader(header: string): string | null {
  const trimmed = header.trim();

  // Try M/D/YYYY or MM/DD/YYYY
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, '0');
    const d = slashMatch[2].padStart(2, '0');
    return `${slashMatch[3]}-${m}-${d}`;
  }

  // Try YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Try D-Mon-YY or DD-Mon-YY (e.g. "31-May-26", "1-Jun-26")
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const dMonYYMatch = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(trimmed);
  if (dMonYYMatch) {
    const mon = months[dMonYYMatch[2].toLowerCase()];
    if (mon) {
      const day = dMonYYMatch[1].padStart(2, '0');
      const yearShort = parseInt(dMonYYMatch[3], 10);
      const year = yearShort >= 50 ? 1900 + yearShort : 2000 + yearShort;
      return `${year}-${mon}-${day}`;
    }
  }

  // Try D-Mon-YYYY or DD-Mon-YYYY (e.g. "31-May-2026", "1-Jun-2026")
  const dMonYYYYMatch = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(trimmed);
  if (dMonYYYYMatch) {
    const mon = months[dMonYYYYMatch[2].toLowerCase()];
    if (mon) {
      const day = dMonYYYYMatch[1].padStart(2, '0');
      return `${dMonYYYYMatch[3]}-${mon}-${day}`;
    }
  }

  // Try D-Mon or DD-Mon without year (e.g. "31-May", "1-Jun") — infer current year
  const dMonMatch = /^(\d{1,2})-([A-Za-z]{3})$/.exec(trimmed);
  if (dMonMatch) {
    const mon = months[dMonMatch[2].toLowerCase()];
    if (mon) {
      const day = dMonMatch[1].padStart(2, '0');
      const year = new Date().getFullYear();
      return `${year}-${mon}-${day}`;
    }
  }

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

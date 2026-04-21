import Papa from 'papaparse';
import type { RawHeatmapRow, HeatmapRow, ValidationResult, ValidationError } from '../types.js';

const REQUIRED_COLUMNS = ['Date', 'Program', 'Interval_Start_Time', 'Over_Under_Value'] as const;
// Lobby is optional — defaults to empty string if missing

/**
 * Normalizes a date string to YYYY-MM-DD format.
 * Accepts: "4/5/2026", "04/05/2026", "2026-04-05", etc.
 */
export function normalizeDate(dateStr: string): string | null {
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, '0');
    const d = slashMatch[2].padStart(2, '0');
    return `${slashMatch[3]}-${m}-${d}`;
  }

  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const dMonMatch = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(trimmed);
  if (dMonMatch) {
    const mon = months[dMonMatch[2].toLowerCase()];
    if (mon) {
      return `${dMonMatch[3]}-${mon}-${dMonMatch[1].padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Normalizes a time string to HH:MM format (24-hour).
 */
export function normalizeInterval(time: string): string | null {
  const trimmed = time.trim().toUpperCase();

  const match24 = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed);
  if (match24) {
    const h = parseInt(match24[1], 10);
    const m = parseInt(match24[2], 10);
    if (h >= 0 && h <= 23 && (m === 0 || m === 30)) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return null;
  }

  const match12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(trimmed);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = parseInt(match12[2], 10);
    const period = match12[3];
    if (h < 1 || h > 12 || (m !== 0 && m !== 30)) return null;
    if (period === 'AM' && h === 12) h = 0;
    if (period === 'PM' && h !== 12) h += 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return null;
}

/**
 * Validates that a time string is a valid half-hour interval.
 */
export function isValidHalfHourInterval(time: string): boolean {
  return normalizeInterval(time) !== null;
}

/**
 * Validates an array of raw heatmap rows.
 */
export function validateHeatmapRows(rows: RawHeatmapRow[]): ValidationResult<HeatmapRow> {
  const valid: HeatmapRow[] = [];
  const errors: ValidationError[] = [];

  if (rows.length > 0) {
    const columns = Object.keys(rows[0]);
    for (const col of REQUIRED_COLUMNS) {
      if (!columns.includes(col)) {
        errors.push({ row: 0, field: col, message: `Missing required column: ${col}` });
      }
    }
    if (errors.length > 0) return { valid, errors };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;
    let rowValid = true;

    if (!row.Date || row.Date.trim() === '') {
      errors.push({ row: rowNum, field: 'Date', message: `Row ${rowNum}: Date is required` });
      rowValid = false;
    } else {
      const normalized = normalizeDate(row.Date.trim());
      if (!normalized) {
        errors.push({ row: rowNum, field: 'Date', message: `Row ${rowNum}: Date format not recognized` });
        rowValid = false;
      }
    }

    if (!row.Program || row.Program.trim() === '') {
      errors.push({ row: rowNum, field: 'Program', message: `Row ${rowNum}: Program is required` });
      rowValid = false;
    }

    if (!row.Interval_Start_Time || !isValidHalfHourInterval(row.Interval_Start_Time.trim())) {
      errors.push({
        row: rowNum,
        field: 'Interval_Start_Time',
        message: `Row ${rowNum}: Interval_Start_Time must be a valid half-hour interval`,
      });
      rowValid = false;
    }

    const overUnderStr = row.Over_Under_Value?.trim() ?? '';
    if (overUnderStr === '' || isNaN(Number(overUnderStr))) {
      errors.push({
        row: rowNum,
        field: 'Over_Under_Value',
        message: `Row ${rowNum}: Over_Under_Value must be numeric`,
      });
      rowValid = false;
    }

    if (rowValid) {
      valid.push({
        date: normalizeDate(row.Date!.trim())!,
        program: row.Program!.trim(),
        lobby: row.Lobby?.trim() ?? '',
        intervalStartTime: normalizeInterval(row.Interval_Start_Time!.trim())!,
        overUnderValue: Number(overUnderStr),
      });
    }
  }

  return { valid, errors };
}

/**
 * Known month abbreviations for pivot date column headers like "31-May", "1-Jun".
 */
const MONTH_ABBR: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Checks if a column header looks like a date (e.g. "31-May", "1-Jun", "15-Dec").
 */
function isDateColumn(header: string): boolean {
  const match = /^(\d{1,2})-([A-Za-z]{3})$/.exec(header.trim());
  if (!match) return false;
  return MONTH_ABBR[match[2].toLowerCase()] !== undefined;
}

/**
 * Converts a pivot date column header (e.g. "31-May") to YYYY-MM-DD.
 * Uses the current year by default; if the resulting date is more than
 * 6 months in the past, assumes next year.
 */
export function pivotDateToISO(header: string): string | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})$/.exec(header.trim());
  if (!match) return null;
  const day = match[1].padStart(2, '0');
  const mon = MONTH_ABBR[match[2].toLowerCase()];
  if (!mon) return null;

  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(`${year}-${mon}-${day}T00:00:00`);
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  if (candidate < sixMonthsAgo) {
    year += 1;
  }
  return `${year}-${mon}-${day}`;
}

/**
 * Converts a pivot-style interval (e.g. "0000", "0030", "1430") to HH:MM.
 * Also accepts HH:MM format directly (e.g. "07:00", "7:00").
 */
export function pivotIntervalToTime(interval: string): string | null {
  const trimmed = interval.trim();

  // Try HH:MM or H:MM format first (from normalizeInterval)
  const normalized = normalizeInterval(trimmed);
  if (normalized) return normalized;

  // Try 4-digit format (e.g. "0000", "0030", "1430")
  const match = /^(\d{2})(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || (m !== 0 && m !== 30)) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Detects whether parsed CSV data is in pivot format.
 * Pivot format has an "Interval" column and date columns like "31-May".
 */
export function isPivotFormat(headers: string[]): boolean {
  const hasInterval = headers.some(h => h.trim().toLowerCase() === 'interval');
  const dateColumns = headers.filter(isDateColumn);
  return hasInterval && dateColumns.length > 0;
}

/**
 * Converts pivot-format rows into standard RawHeatmapRow format.
 * Pivot format: Program, Lobby (optional), Interval, 31-May, 1-Jun, ...
 * Standard format: Date, Program, Lobby, Interval_Start_Time, Over_Under_Value
 */
export function convertPivotToStandard(
  headers: string[],
  rows: Record<string, string>[],
): RawHeatmapRow[] {
  const dateColumns = headers.filter(isDateColumn);
  const hasProgram = headers.some(h => h.trim().toLowerCase() === 'program');
  const hasLobby = headers.some(h => h.trim().toLowerCase() === 'lobby');
  const intervalKey = headers.find(h => h.trim().toLowerCase() === 'interval') ?? 'Interval';
  const programKey = headers.find(h => h.trim().toLowerCase() === 'program') ?? 'Program';
  const lobbyKey = headers.find(h => h.trim().toLowerCase() === 'lobby') ?? 'Lobby';

  const result: RawHeatmapRow[] = [];

  for (const row of rows) {
    const rawInterval = row[intervalKey]?.trim() ?? '';
    const program = hasProgram ? (row[programKey]?.trim() ?? '') : '';
    const lobby = hasLobby ? (row[lobbyKey]?.trim() ?? '') : '';

    for (const dateCol of dateColumns) {
      const value = row[dateCol]?.trim() ?? '';
      if (value === '') continue;

      const isoDate = pivotDateToISO(dateCol);
      const time = pivotIntervalToTime(rawInterval);

      result.push({
        Date: isoDate ?? dateCol,
        Program: program,
        Lobby: lobby,
        Interval_Start_Time: time ?? rawInterval,
        Over_Under_Value: value,
      });
    }
  }

  return result;
}

/**
 * Parses a heatmap CSV string and validates the rows.
 * Auto-detects pivot format (Interval × Date columns) and converts it
 * to the standard vertical format before validation.
 */
export function parseHeatmapCSV(csvString: string): ValidationResult<HeatmapRow> {
  const results = Papa.parse<Record<string, string>>(csvString, {
    header: true,
    skipEmptyLines: true,
  });

  const headers = results.meta.fields ?? [];

  if (isPivotFormat(headers)) {
    const converted = convertPivotToStandard(headers, results.data);
    return validateHeatmapRows(converted);
  }

  return validateHeatmapRows(results.data as RawHeatmapRow[]);
}

/**
 * Parses a D-Mon or DD-Mon date header (e.g., "31-May", "1-Jun") to YYYY-MM-DD.
 * Infers year from referenceYear (defaults to current year).
 * Handles Dec→Jan rollover: if the parsed month is more than 6 months before
 * the reference month, assume next year.
 */
export function parseDateHeader(header: string, referenceYear?: number): string | null {
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const match = /^(\d{1,2})-([A-Za-z]{3})$/.exec(header.trim());
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const mon = months[match[2].toLowerCase()];
  if (!mon) return null;
  if (day < 1 || day > 31) return null;

  const now = new Date();
  let year = referenceYear ?? now.getFullYear();

  // Handle Dec→Jan rollover: if the header month is Jan-Feb and current month is Nov-Dec,
  // assume next year
  const refMonth = now.getMonth() + 1; // 1-based
  if (mon <= 2 && refMonth >= 11 && referenceYear === undefined) {
    year += 1;
  }

  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Detects whether the CSV columns represent a pivot/crosstab format.
 * Pivot format has Program + Interval columns but lacks Date and Over_Under_Value,
 * and has date-like column headers (D-Mon pattern).
 */
export function detectPivotFormat(columns: string[]): { isPivot: boolean; dateColumns: string[] } {
  const hasInterval = columns.some(c => c.trim() === 'Interval');
  const hasDate = columns.some(c => c.trim() === 'Date');
  const hasOverUnder = columns.some(c => c.trim() === 'Over_Under_Value');

  if (!hasInterval || hasDate || hasOverUnder) {
    return { isPivot: false, dateColumns: [] };
  }

  const dateColumns: string[] = [];
  for (const col of columns) {
    if (parseDateHeader(col.trim()) !== null) {
      dateColumns.push(col);
    }
  }

  return {
    isPivot: dateColumns.length > 0,
    dateColumns,
  };
}

/**
 * Transposes pivot-format rows into flat RawHeatmapRow records.
 * For each row × each date column, produces one RawHeatmapRow with:
 *   Date = parseDateHeader(dateColumnHeader)
 *   Program = row.Program
 *   Interval_Start_Time = row.Interval
 *   Over_Under_Value = cell value
 * Skips cells that are empty or whitespace-only.
 */
export function transposePivotRows(
  rawRows: Record<string, string>[],
  dateColumns: string[],
  refYear?: number,
): RawHeatmapRow[] {
  const result: RawHeatmapRow[] = [];

  for (const row of rawRows) {
    const program = row['Program']?.trim() ?? '';
    const lobby = row['Lobby']?.trim() ?? '';
    const interval = row['Interval']?.trim() ?? '';

    for (const dateCol of dateColumns) {
      const cellValue = (row[dateCol] ?? '').trim();
      if (cellValue === '') continue;

      const parsedDate = parseDateHeader(dateCol.trim(), refYear);
      if (!parsedDate) continue;

      result.push({
        Date: parsedDate,
        Program: program,
        Lobby: lobby,
        Interval_Start_Time: interval,
        Over_Under_Value: cellValue,
      });
    }
  }

  return result;
}

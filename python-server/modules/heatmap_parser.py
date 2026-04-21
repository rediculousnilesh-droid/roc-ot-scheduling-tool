"""
Heatmap CSV parser with pivot format auto-detection.
Mirrors heatmapParser.ts exactly.
"""
import csv
import io
import re
from datetime import date, datetime

REQUIRED_COLUMNS = ['Date', 'Program', 'Interval_Start_Time', 'Over_Under_Value']

MONTH_ABBR = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
}


def normalize_date(date_str):
    """Normalizes a date string to YYYY-MM-DD format."""
    trimmed = date_str.strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}$', trimmed):
        return trimmed

    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', trimmed)
    if m:
        month = m.group(1).zfill(2)
        day = m.group(2).zfill(2)
        return f"{m.group(3)}-{month}-{day}"

    m = re.match(r'^(\d{1,2})-([A-Za-z]{3})-(\d{4})$', trimmed)
    if m:
        mon = MONTH_ABBR.get(m.group(2).lower())
        if mon:
            return f"{m.group(3)}-{mon}-{m.group(1).zfill(2)}"

    return None


def normalize_interval(time_str):
    """Normalizes a time string to HH:MM format (24-hour)."""
    trimmed = time_str.strip().upper()

    m24 = re.match(r'^(\d{1,2}):(\d{1,2})$', trimmed)
    if m24:
        h = int(m24.group(1))
        mins = int(m24.group(2))
        if 0 <= h <= 23 and mins in (0, 30):
            return f"{str(h).zfill(2)}:{str(mins).zfill(2)}"
        return None

    m12 = re.match(r'^(\d{1,2}):(\d{2})\s*(AM|PM)$', trimmed)
    if m12:
        h = int(m12.group(1))
        mins = int(m12.group(2))
        period = m12.group(3)
        if h < 1 or h > 12 or mins not in (0, 30):
            return None
        if period == 'AM' and h == 12:
            h = 0
        if period == 'PM' and h != 12:
            h += 12
        return f"{str(h).zfill(2)}:{str(mins).zfill(2)}"

    return None


def is_valid_half_hour_interval(time_str):
    return normalize_interval(time_str) is not None


def _is_date_column(header):
    """Checks if a column header looks like a date (e.g. '31-May', '1-Jun')."""
    m = re.match(r'^(\d{1,2})-([A-Za-z]{3})$', header.strip())
    if not m:
        return False
    return m.group(2).lower() in MONTH_ABBR


def pivot_date_to_iso(header):
    """Converts a pivot date column header (e.g. '31-May') to YYYY-MM-DD."""
    m = re.match(r'^(\d{1,2})-([A-Za-z]{3})$', header.strip())
    if not m:
        return None
    day = m.group(1).zfill(2)
    mon = MONTH_ABBR.get(m.group(2).lower())
    if not mon:
        return None

    now = datetime.now()
    year = now.year
    try:
        candidate = datetime(year, int(mon), int(day))
    except ValueError:
        return None
    from dateutil.relativedelta import relativedelta
    six_months_ago = now - relativedelta(months=6)
    if candidate < six_months_ago:
        year += 1
    return f"{year}-{mon}-{day}"


def _pivot_date_to_iso_simple(header):
    """Converts pivot date header without dateutil dependency."""
    m = re.match(r'^(\d{1,2})-([A-Za-z]{3})$', header.strip())
    if not m:
        return None
    day = m.group(1).zfill(2)
    mon = MONTH_ABBR.get(m.group(2).lower())
    if not mon:
        return None

    now = datetime.now()
    year = now.year
    try:
        candidate = datetime(year, int(mon), int(day))
    except ValueError:
        return None
    # 6 months ago approximation
    six_months_ago_month = now.month - 6
    six_months_ago_year = now.year
    if six_months_ago_month <= 0:
        six_months_ago_month += 12
        six_months_ago_year -= 1
    try:
        six_months_ago = datetime(six_months_ago_year, six_months_ago_month, min(now.day, 28))
    except ValueError:
        six_months_ago = datetime(six_months_ago_year, six_months_ago_month, 28)
    if candidate < six_months_ago:
        year += 1
    return f"{year}-{mon}-{day}"


def pivot_interval_to_time(interval):
    """Converts a pivot-style interval (e.g. '0000', '0030', '1430', '0:0', '1:30') to HH:MM.
    Tries normalize_interval first to handle formats like '0:0', '1:30', then falls back
    to the 4-digit format."""
    trimmed = interval.strip()

    # Try normalize_interval first (handles "0:0", "1:30", "07:00", etc.)
    normalized = normalize_interval(trimmed)
    if normalized is not None:
        return normalized

    # Fall back to 4-digit format (e.g. '0000', '0030', '1430')
    m = re.match(r'^(\d{2})(\d{2})$', trimmed)
    if not m:
        return None
    h = int(m.group(1))
    mins = int(m.group(2))
    if h < 0 or h > 23 or mins not in (0, 30):
        return None
    return f"{str(h).zfill(2)}:{str(mins).zfill(2)}"


def is_pivot_format(headers):
    """Detects whether parsed CSV data is in pivot format."""
    has_interval = any(h.strip().lower() == 'interval' for h in headers)
    date_columns = [h for h in headers if _is_date_column(h)]
    return has_interval and len(date_columns) > 0


def convert_pivot_to_standard(headers, rows):
    """Converts pivot-format rows into standard RawHeatmapRow format."""
    date_columns = [h for h in headers if _is_date_column(h)]
    interval_key = next((h for h in headers if h.strip().lower() == 'interval'), 'Interval')
    program_key = next((h for h in headers if h.strip().lower() == 'program'), 'Program')
    lobby_key = next((h for h in headers if h.strip().lower() == 'lobby'), 'Lobby')
    has_program = any(h.strip().lower() == 'program' for h in headers)
    has_lobby = any(h.strip().lower() == 'lobby' for h in headers)

    result = []
    for row in rows:
        raw_interval = (row.get(interval_key) or '').strip()
        program = (row.get(program_key) or '').strip() if has_program else ''
        lobby = (row.get(lobby_key) or '').strip() if has_lobby else ''

        for date_col in date_columns:
            value = (row.get(date_col) or '').strip()
            if not value:
                continue
            iso_date = _pivot_date_to_iso_simple(date_col)
            time_val = pivot_interval_to_time(raw_interval)
            result.append({
                'Date': iso_date or date_col,
                'Program': program,
                'Lobby': lobby,
                'Interval_Start_Time': time_val or raw_interval,
                'Over_Under_Value': value,
            })
    return result


def validate_heatmap_rows(rows):
    """Validates an array of raw heatmap rows."""
    valid = []
    errors = []

    if rows:
        columns = list(rows[0].keys())
        for col in REQUIRED_COLUMNS:
            if col not in columns:
                errors.append({'row': 0, 'field': col, 'message': f'Missing required column: {col}'})
        if errors:
            return {'valid': valid, 'errors': errors}

    for i, row in enumerate(rows):
        row_num = i + 1
        row_valid = True

        date_val = (row.get('Date') or '').strip()
        if not date_val:
            errors.append({'row': row_num, 'field': 'Date', 'message': f'Row {row_num}: Date is required'})
            row_valid = False
        else:
            normalized_date = normalize_date(date_val)
            if not normalized_date:
                errors.append({'row': row_num, 'field': 'Date', 'message': f'Row {row_num}: Date format not recognized'})
                row_valid = False

        program_val = (row.get('Program') or '').strip()
        if not program_val:
            errors.append({'row': row_num, 'field': 'Program', 'message': f'Row {row_num}: Program is required'})
            row_valid = False

        interval_val = (row.get('Interval_Start_Time') or '').strip()
        if not interval_val or not is_valid_half_hour_interval(interval_val):
            errors.append({
                'row': row_num, 'field': 'Interval_Start_Time',
                'message': f'Row {row_num}: Interval_Start_Time must be a valid half-hour interval',
            })
            row_valid = False

        over_under_str = (row.get('Over_Under_Value') or '').strip()
        if not over_under_str:
            errors.append({
                'row': row_num, 'field': 'Over_Under_Value',
                'message': f'Row {row_num}: Over_Under_Value must be numeric',
            })
            row_valid = False
        else:
            try:
                float(over_under_str)
            except ValueError:
                errors.append({
                    'row': row_num, 'field': 'Over_Under_Value',
                    'message': f'Row {row_num}: Over_Under_Value must be numeric',
                })
                row_valid = False

        if row_valid:
            valid.append({
                'date': normalize_date(date_val),
                'program': program_val,
                'lobby': (row.get('Lobby') or '').strip(),
                'intervalStartTime': normalize_interval(interval_val),
                'overUnderValue': float(over_under_str),
            })

    return {'valid': valid, 'errors': errors}


def parse_heatmap_csv(csv_string):
    """Parses a heatmap CSV string and validates the rows.
    Auto-detects pivot format and converts before validation."""
    reader = csv.DictReader(io.StringIO(csv_string))
    headers = reader.fieldnames or []
    rows = list(reader)

    if is_pivot_format(headers):
        converted = convert_pivot_to_standard(headers, rows)
        return validate_heatmap_rows(converted)

    return validate_heatmap_rows(rows)

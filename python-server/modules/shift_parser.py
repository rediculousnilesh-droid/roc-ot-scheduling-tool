"""
Shift roster CSV parser.
Mirrors shiftParser.ts exactly.
"""
import csv
import io
import re


def normalize_date_header(header):
    """Normalizes date headers like '4/15/2026' or '04/15/2026' to 'YYYY-MM-DD'."""
    trimmed = header.strip()

    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', trimmed)
    if m:
        month = m.group(1).zfill(2)
        day = m.group(2).zfill(2)
        return f"{m.group(3)}-{month}-{day}"

    if re.match(r'^\d{4}-\d{2}-\d{2}$', trimmed):
        return trimmed

    return None


NON_WORKING_KEYWORDS = [
    'WO', 'W/O', 'OFF', 'WEEKOFF', 'WEEK OFF',
    'LEAVE', 'MTL', 'PTL', 'LONG LEAVE', 'LL',
    'CL', 'SL', 'PL', 'EL', 'ML', 'AL',
    'ABSENT', 'ABS', 'NA', 'N/A', 'HOLIDAY',
    'TRAINING', 'TRG',
]


def is_non_working_keyword(value):
    """Checks if a cell value is a non-working keyword."""
    trimmed = value.strip().upper()
    if not trimmed:
        return False
    for kw in NON_WORKING_KEYWORDS:
        if trimmed == kw or trimmed.startswith(kw + ' ') or trimmed.endswith(' ' + kw):
            return True
    return False


def parse_shift_time(value):
    """Parses a shift time like '07:00-16:00' into start/end."""
    trimmed = value.strip().upper()
    if not trimmed:
        return None
    if is_non_working_keyword(trimmed):
        return None

    m = re.match(r'^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$', trimmed)
    if not m:
        return None

    def normalize_time(t):
        parts = t.split(':')
        return parts[0].zfill(2) + ':' + parts[1]

    return {'start': normalize_time(m.group(1)), 'end': normalize_time(m.group(2))}


def parse_shift_csv(csv_string):
    """Parses a shift roster CSV string."""
    reader = csv.DictReader(io.StringIO(csv_string))
    headers = reader.fieldnames or []
    rows = list(reader)

    errors = []
    entries = []

    if not rows:
        return {
            'roster': {'entries': [], 'agents': [], 'managers': [], 'programs': [], 'lobbies': [], 'dates': []},
            'errors': [],
        }

    # Find column names (case-insensitive)
    agent_col = next((h for h in headers if h.strip().lower() == 'agent'), None)
    manager_col = next((h for h in headers if h.strip().lower() == 'manager'), None)
    program_col = next((h for h in headers if h.strip().lower() == 'program'), None)
    lobby_col = next((h for h in headers if h.strip().lower() == 'lobby'), None)

    if not agent_col:
        errors.append({'row': 0, 'field': 'Agent', 'message': 'Missing required column: Agent'})
    if not program_col:
        errors.append({'row': 0, 'field': 'Program', 'message': 'Missing required column: Program'})
    if not manager_col:
        errors.append({'row': 0, 'field': 'Manager', 'message': 'Missing required column: Manager'})
    if errors:
        return {
            'roster': {'entries': [], 'agents': [], 'managers': [], 'programs': [], 'lobbies': [], 'dates': []},
            'errors': errors,
        }

    # Find date columns
    date_columns = []
    for h in headers:
        lower = h.strip().lower()
        if lower in ('agent', 'manager', 'program', 'lobby'):
            continue
        normalized = normalize_date_header(h)
        if normalized:
            date_columns.append({'header': h, 'normalized': normalized})

    if not date_columns:
        errors.append({'row': 0, 'field': 'dates', 'message': 'No valid date columns found'})
        return {
            'roster': {'entries': [], 'agents': [], 'managers': [], 'programs': [], 'lobbies': [], 'dates': []},
            'errors': errors,
        }

    for i, row in enumerate(rows):
        row_num = i + 1
        agent = (row.get(agent_col) or '').strip()
        manager = (row.get(manager_col) or '').strip()
        program = (row.get(program_col) or '').strip()
        lobby = (row.get(lobby_col) or '').strip() if lobby_col else ''

        if not agent:
            errors.append({'row': row_num, 'field': 'Agent', 'message': f'Row {row_num}: Agent is required'})
            continue

        for dc in date_columns:
            cell_value = (row.get(dc['header']) or '').strip()
            if not cell_value:
                continue
            shift = parse_shift_time(cell_value)
            entries.append({
                'agent': agent,
                'program': program,
                'lobby': lobby,
                'manager': manager,
                'date': dc['normalized'],
                'shiftStart': shift['start'] if shift else '',
                'shiftEnd': shift['end'] if shift else '',
                'isWeeklyOff': shift is None,
            })

    agents = sorted(set(e['agent'] for e in entries))
    managers = sorted(set(e['manager'] for e in entries if e.get('manager')))
    programs = sorted(set(e['program'] for e in entries if e.get('program')))
    lobbies = sorted(set(e['lobby'] for e in entries if e.get('lobby')))
    dates = sorted(set(dc['normalized'] for dc in date_columns))

    return {
        'roster': {'entries': entries, 'agents': agents, 'managers': managers, 'programs': programs, 'lobbies': lobbies, 'dates': dates},
        'errors': errors,
    }

"""
Fill rate calculations.
Mirrors fillRateCalculator.ts exactly.
"""
from datetime import date as date_type


def get_week(date_str):
    """Returns the ISO week string for a date, e.g. '2025-W15'."""
    d = date_type.fromisoformat(date_str)
    iso_year, iso_week, _ = d.isocalendar()
    return f"{iso_year}-W{str(iso_week).zfill(2)}"


def _is_relevant(slot):
    return slot['status'] in ('Released', 'Filled')


def _compute_rate(released, filled):
    return {
        'totalReleased': released,
        'totalFilled': filled,
        'fillRate': round((filled / released) * 10000) / 100 if released > 0 else None,
    }


def calculate_overall_fill_rate(slots):
    relevant = [s for s in slots if _is_relevant(s)]
    filled = len([s for s in relevant if s['status'] == 'Filled'])
    return _compute_rate(len(relevant), filled)


def calculate_fill_rate_by_program(slots):
    groups = {}
    for s in slots:
        if not _is_relevant(s):
            continue
        groups.setdefault(s['program'], []).append(s)
    result = {}
    for program, group_slots in groups.items():
        filled = len([s for s in group_slots if s['status'] == 'Filled'])
        result[program] = _compute_rate(len(group_slots), filled)
    return result


def calculate_fill_rate_by_manager(slots, roster):
    program_to_managers = {}
    for entry in roster.get('entries', []):
        program_to_managers.setdefault(entry['program'], set()).add(entry['manager'])

    groups = {}
    for s in slots:
        if not _is_relevant(s):
            continue
        managers = program_to_managers.get(s['program'], set())
        for manager in managers:
            if manager not in groups:
                groups[manager] = {'released': 0, 'filled': 0}
            groups[manager]['released'] += 1
            if s['status'] == 'Filled':
                groups[manager]['filled'] += 1

    result = {}
    for manager, data in groups.items():
        result[manager] = _compute_rate(data['released'], data['filled'])
    return result


def calculate_fill_rate_by_date(slots):
    groups = {}
    for s in slots:
        if not _is_relevant(s):
            continue
        groups.setdefault(s['date'], []).append(s)
    result = {}
    for d, group_slots in groups.items():
        filled = len([s for s in group_slots if s['status'] == 'Filled'])
        result[d] = _compute_rate(len(group_slots), filled)
    return result


def calculate_fill_rate_by_week(slots):
    groups = {}
    for s in slots:
        if not _is_relevant(s):
            continue
        week = get_week(s['date'])
        groups.setdefault(week, []).append(s)
    result = {}
    for week, group_slots in groups.items():
        filled = len([s for s in group_slots if s['status'] == 'Filled'])
        result[week] = _compute_rate(len(group_slots), filled)
    return result


def calculate_fill_rate_by_program_week(slots):
    groups = {}
    for s in slots:
        if not _is_relevant(s):
            continue
        week = get_week(s['date'])
        groups.setdefault(s['program'], {})
        groups[s['program']].setdefault(week, []).append(s)
    result = {}
    for program, week_map in groups.items():
        inner = {}
        for week, group_slots in week_map.items():
            filled = len([s for s in group_slots if s['status'] == 'Filled'])
            inner[week] = _compute_rate(len(group_slots), filled)
        result[program] = inner
    return result


def calculate_fill_rate_by_manager_week(slots, roster):
    program_to_managers = {}
    for entry in roster.get('entries', []):
        program_to_managers.setdefault(entry['program'], set()).add(entry['manager'])

    groups = {}
    for s in slots:
        if not _is_relevant(s):
            continue
        week = get_week(s['date'])
        managers = program_to_managers.get(s['program'], set())
        for manager in managers:
            groups.setdefault(manager, {})
            if week not in groups[manager]:
                groups[manager][week] = {'released': 0, 'filled': 0}
            groups[manager][week]['released'] += 1
            if s['status'] == 'Filled':
                groups[manager][week]['filled'] += 1

    result = {}
    for manager, week_map in groups.items():
        inner = {}
        for week, data in week_map.items():
            inner[week] = _compute_rate(data['released'], data['filled'])
        result[manager] = inner
    return result


def calculate_all_fill_rates(slots, roster):
    return {
        'overall': calculate_overall_fill_rate(slots),
        'byProgram': calculate_fill_rate_by_program(slots),
        'byManager': calculate_fill_rate_by_manager(slots, roster),
        'byDate': calculate_fill_rate_by_date(slots),
        'byWeek': calculate_fill_rate_by_week(slots),
        'byProgramWeek': calculate_fill_rate_by_program_week(slots),
        'byManagerWeek': calculate_fill_rate_by_manager_week(slots, roster),
    }

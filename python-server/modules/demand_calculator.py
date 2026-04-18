"""
Cost-efficient OT demand calculation.
Mirrors demandCalculator.ts exactly.
"""
import math
import re

# ── Interval helpers (same logic as auto_slot_generator / revised_heatmap) ──

ALL_INTERVALS = []
for _i in range(48):
    _h = str(_i // 2).zfill(2)
    _m = '00' if _i % 2 == 0 else '30'
    ALL_INTERVALS.append(f"{_h}:{_m}")


def _interval_index(time_str):
    parts = time_str.split(':')
    h = int(parts[0])
    m = int(parts[1])
    return h * 2 + (1 if m >= 30 else 0)


def _index_to_time(idx):
    i = idx
    if i >= 48:
        i -= 48
    if i < 0:
        i += 48
    h = i // 2
    m = '00' if i % 2 == 0 else '30'
    return f"{str(h).zfill(2)}:{m}"


# ── Main export ──

def compute_demand(heatmap_data, shifts, program, tolerance=-2):
    """Compute cost-efficient OT demand.

    Args:
        heatmap_data: list of dicts with keys date, program, lobby,
                      intervalStartTime, overUnderValue
        shifts: list of dicts with keys agent, program, lobby, manager,
                date, shiftStart, shiftEnd, isWeeklyOff
        program: str - the program identifier
        tolerance: float - acceptable deficit per interval, between -2 and -1
                   inclusive. Defaults to -2.

    Returns:
        dict with keys: demand_windows, recommendations, revised_heatmap,
                        summary, deficit_blocks
    """
    # 1. Validate tolerance
    tol = tolerance if tolerance is not None else -2
    if not isinstance(tol, (int, float)) or math.isnan(tol):
        raise ValueError('Tolerance must be a numeric value.')
    if tol < -2 or tol > -1:
        raise ValueError(
            f'Tolerance must be between -2 and -1 inclusive. Received: {tol}'
        )

    # Edge case: empty inputs
    if len(heatmap_data) == 0 or len(shifts) == 0:
        return _empty_result(heatmap_data)

    # 2. Build interval map: date|program|lobby → intervalStartTime → overUnderValue
    interval_map = _build_interval_map(heatmap_data, program)

    # 3. Identify candidate OT windows
    candidates = _identify_candidate_windows(shifts, program, interval_map)

    if len(candidates) == 0:
        return _empty_result(heatmap_data)

    # Sort candidates chronologically (by date, then startIdx) for deterministic budget allocation
    candidates.sort(key=lambda c: (c['date'], c['start_idx']))

    # 4-6. Compute average deficit, apply tolerance threshold, enforce budget
    tolerance_budget = {}  # BudgetKey → int
    qualified_windows = []
    used_slot_keys = set()

    for candidate in candidates:
        # Deduplication
        if candidate['slot_key'] in used_slot_keys:
            continue

        map_key = f"{candidate['date']}|{candidate['program']}|{candidate['lobby']}"
        intervals = interval_map.get(map_key)
        if intervals is None:
            continue

        # 4. Compute average deficit for this window
        total = 0
        count = 0
        for i in range(candidate['start_idx'], candidate['end_idx']):
            actual_idx = i % 48
            time_str = ALL_INTERVALS[actual_idx]
            val = intervals.get(time_str)
            if val is not None:
                total += val
                count += 1

        if count == 0:
            continue
        average_deficit = total / count

        # 6. Enforce tolerance budget
        budget_key = (
            f"{candidate['shift_start']}-{candidate['shift_end']}|"
            f"{candidate['date']}|{candidate['program']}|{candidate['lobby']}"
        )
        used_budget = tolerance_budget.get(budget_key, 0)
        effective_tolerance = 0 if used_budget >= 2 else tol

        # 5. Apply tolerance threshold
        if average_deficit >= effective_tolerance:
            continue

        effective_demand = math.ceil(abs(average_deficit - effective_tolerance))

        # Track tolerance budget usage
        tolerance_intervals_used = (
            min(count, 2 - used_budget) if effective_tolerance != 0 else 0
        )
        tolerance_budget[budget_key] = used_budget + tolerance_intervals_used

        used_slot_keys.add(candidate['slot_key'])

        qualified_windows.append({
            'date': candidate['date'],
            'program': candidate['program'],
            'lobby': candidate['lobby'],
            'start_interval': _index_to_time(candidate['start_idx']),
            'end_interval': _index_to_time(candidate['end_idx']),
            'start_idx': candidate['start_idx'],
            'end_idx': candidate['end_idx'],
            'average_deficit': average_deficit,
            'effective_demand': effective_demand,
            'tolerance_intervals_used': tolerance_intervals_used,
            'shift_start': candidate['shift_start'],
            'shift_end': candidate['shift_end'],
            'agent': candidate['agent'],
            'manager': candidate['manager'],
            'shift_str': candidate['shift_str'],
            'ot_type': candidate['ot_type'],
        })

    if len(qualified_windows) == 0:
        return _empty_result(heatmap_data)

    # 7. Generate OTRecommendation records
    recommendations = []
    demand_windows = []
    summary = {
        'total': 0,
        'oneHrPre': 0,
        'oneHrPost': 0,
        'twoHrPre': 0,
        'twoHrPost': 0,
        'fullDay': 0,
    }

    for w in qualified_windows:
        ot_time_window = f"{w['start_interval']}-{w['end_interval']}"
        deficit_block = f"{w['start_interval']}-{w['end_interval']}"

        recommendations.append({
            'date': w['date'],
            'program': w['program'],
            'lobby': w['lobby'],
            'agent': w['agent'],
            'manager': w['manager'],
            'shift': w['shift_str'],
            'otType': w['ot_type'],
            'otTimeWindow': ot_time_window,
            'deficitBlock': deficit_block,
        })

        demand_windows.append({
            'date': w['date'],
            'program': w['program'],
            'lobby': w['lobby'],
            'startInterval': w['start_interval'],
            'endInterval': w['end_interval'],
            'startIdx': w['start_idx'],
            'endIdx': w['end_idx'],
            'averageDeficit': w['average_deficit'],
            'effectiveDemand': w['effective_demand'],
            'toleranceIntervalsUsed': w['tolerance_intervals_used'],
            'shiftStart': w['shift_start'],
            'shiftEnd': w['shift_end'],
        })

        summary['total'] += 1
        ot_type = w['ot_type']
        if ot_type == '1hr Pre Shift OT':
            summary['oneHrPre'] += 1
        elif ot_type == '1hr Post Shift OT':
            summary['oneHrPost'] += 1
        elif ot_type == '2hr Pre Shift OT':
            summary['twoHrPre'] += 1
        elif ot_type == '2hr Post Shift OT':
            summary['twoHrPost'] += 1
        elif ot_type == 'Full Day OT':
            summary['fullDay'] += 1

    # 8. Compute revised heatmap
    revised_heatmap = _compute_revised_heatmap_from_windows(
        heatmap_data, qualified_windows
    )

    # 9. Produce backward-compatible DeficitBlock records
    deficit_blocks = _produce_deficit_blocks(demand_windows)

    return {
        'demand_windows': demand_windows,
        'recommendations': recommendations,
        'revised_heatmap': revised_heatmap,
        'summary': summary,
        'deficit_blocks': deficit_blocks,
    }


# ── Internal helpers ──

def _empty_result(heatmap_data):
    return {
        'demand_windows': [],
        'recommendations': [],
        'revised_heatmap': list(heatmap_data),
        'summary': {
            'total': 0,
            'oneHrPre': 0,
            'oneHrPost': 0,
            'twoHrPre': 0,
            'twoHrPost': 0,
            'fullDay': 0,
        },
        'deficit_blocks': [],
    }


def _build_interval_map(heatmap_data, program):
    """Build interval map: groups heatmap data by 'date|program|lobby'
    → dict of intervalStartTime → overUnderValue."""
    result = {}
    for row in heatmap_data:
        if row['program'] != program:
            continue
        key = f"{row['date']}|{row['program']}|{row.get('lobby', '')}"
        if key not in result:
            result[key] = {}
        result[key][row['intervalStartTime']] = row['overUnderValue']
    return result


def _identify_candidate_windows(shifts, program, interval_map):
    """Identify candidate OT windows for each shift on each date.
    Mirrors the OT window selection logic from autoSlotGenerator:
    - Try 2hr pre first; if no overlap with deficit, try 1hr pre
    - Try 2hr post first; if no overlap with deficit, try 1hr post
    - For WO agents, use Full Day OT
    """
    candidates = []

    # Build WO tracking structures (same as auto_slot_generator)
    agent_wo_days = {}
    for s in shifts:
        if s.get('isWeeklyOff'):
            agent_wo_days.setdefault(s['agent'], []).append(s['date'])

    agent_wo_ot_count = {}

    # Find each agent's regular shift for WO Full Day OT
    agent_regular_shift = {}
    for s in shifts:
        if (not s.get('isWeeklyOff') and s.get('shiftStart')
                and s.get('shiftEnd') and s['agent'] not in agent_regular_shift):
            agent_regular_shift[s['agent']] = f"{s['shiftStart']}-{s['shiftEnd']}"

    # Group shifts by date
    shifts_by_date = {}
    for s in shifts:
        shifts_by_date.setdefault(s['date'], []).append(s)

    used_slot_keys = set()

    for date, date_shifts in shifts_by_date.items():
        working_agents = [
            s for s in date_shifts
            if not s.get('isWeeklyOff') and s.get('shiftStart') and s.get('shiftEnd')
        ]
        wo_agents = [s for s in date_shifts if s.get('isWeeklyOff')]

        # Process working agents: pre/post shift windows
        for shift in working_agents:
            ssi = _interval_index(shift['shiftStart'])
            sei = _interval_index(shift['shiftEnd'])
            agent_lobby = shift.get('lobby', '')
            shift_str = f"{shift['shiftStart']}-{shift['shiftEnd']}"
            map_key = f"{date}|{program}|{agent_lobby}"
            intervals = interval_map.get(map_key)

            def has_deficit_in_range(s, e, _intervals=intervals):
                if _intervals is None:
                    return False
                for i in range(s, e):
                    actual_idx = i % 48
                    if actual_idx < 0:
                        continue
                    time_str = ALL_INTERVALS[actual_idx]
                    val = _intervals.get(time_str)
                    if val is not None and val < 0:
                        return True
                return False

            # Pre-shift windows: try 2hr first, then 1hr
            pre2_start = ssi - 4
            pre2_end = ssi
            pre1_start = ssi - 2
            pre1_end = ssi

            if pre2_start >= 0 and has_deficit_in_range(pre2_start, pre2_end):
                k = f"{date}|{shift['agent']}|pre2|{shift['shiftStart']}"
                if k not in used_slot_keys:
                    used_slot_keys.add(k)
                    candidates.append({
                        'date': date,
                        'program': program,
                        'lobby': agent_lobby,
                        'start_idx': pre2_start,
                        'end_idx': pre2_end,
                        'shift_start': shift['shiftStart'],
                        'shift_end': shift['shiftEnd'],
                        'agent': shift['agent'],
                        'manager': shift['manager'],
                        'shift_str': shift_str,
                        'ot_type': '2hr Pre Shift OT',
                        'slot_key': k,
                    })
            elif pre1_start >= 0 and has_deficit_in_range(pre1_start, pre1_end):
                k = f"{date}|{shift['agent']}|pre1|{shift['shiftStart']}"
                if k not in used_slot_keys:
                    used_slot_keys.add(k)
                    candidates.append({
                        'date': date,
                        'program': program,
                        'lobby': agent_lobby,
                        'start_idx': pre1_start,
                        'end_idx': pre1_end,
                        'shift_start': shift['shiftStart'],
                        'shift_end': shift['shiftEnd'],
                        'agent': shift['agent'],
                        'manager': shift['manager'],
                        'shift_str': shift_str,
                        'ot_type': '1hr Pre Shift OT',
                        'slot_key': k,
                    })

            # Post-shift windows: try 2hr first, then 1hr
            post2_start = sei
            post2_end = sei + 4
            post1_start = sei
            post1_end = sei + 2

            if post2_end <= 48 and has_deficit_in_range(post2_start, post2_end):
                k = f"{date}|{shift['agent']}|post2|{shift['shiftEnd']}"
                if k not in used_slot_keys:
                    used_slot_keys.add(k)
                    candidates.append({
                        'date': date,
                        'program': program,
                        'lobby': agent_lobby,
                        'start_idx': post2_start,
                        'end_idx': post2_end,
                        'shift_start': shift['shiftStart'],
                        'shift_end': shift['shiftEnd'],
                        'agent': shift['agent'],
                        'manager': shift['manager'],
                        'shift_str': shift_str,
                        'ot_type': '2hr Post Shift OT',
                        'slot_key': k,
                    })
            elif post1_end <= 48 and has_deficit_in_range(post1_start, post1_end):
                k = f"{date}|{shift['agent']}|post1|{shift['shiftEnd']}"
                if k not in used_slot_keys:
                    used_slot_keys.add(k)
                    candidates.append({
                        'date': date,
                        'program': program,
                        'lobby': agent_lobby,
                        'start_idx': post1_start,
                        'end_idx': post1_end,
                        'shift_start': shift['shiftStart'],
                        'shift_end': shift['shiftEnd'],
                        'agent': shift['agent'],
                        'manager': shift['manager'],
                        'shift_str': shift_str,
                        'ot_type': '1hr Post Shift OT',
                        'slot_key': k,
                    })

        # WO agents → Full Day OT
        for shift in wo_agents:
            wo_count = agent_wo_ot_count.get(shift['agent'], 0)
            total_wo = len(agent_wo_days.get(shift['agent'], []))
            # Labor law: if agent has 2+ WO days and already has 1 WO OT, skip
            if total_wo >= 2 and wo_count >= 1:
                continue

            k = f"{date}|{shift['agent']}|fullday"
            if k in used_slot_keys:
                continue
            used_slot_keys.add(k)

            rs = agent_regular_shift.get(shift['agent'], 'Full Day')
            agent_lobby = shift.get('lobby', '')

            # Parse regular shift to get start/end indices
            start_idx = 0
            end_idx = 48
            rs_match = re.match(r'^(\d{2}:\d{2})-(\d{2}:\d{2})$', rs)
            if rs_match:
                start_idx = _interval_index(rs_match.group(1))
                end_idx = _interval_index(rs_match.group(2))

            candidates.append({
                'date': date,
                'program': program,
                'lobby': agent_lobby,
                'start_idx': start_idx,
                'end_idx': end_idx,
                'shift_start': rs_match.group(1) if rs_match else '00:00',
                'shift_end': rs_match.group(2) if rs_match else '23:30',
                'agent': shift['agent'],
                'manager': shift['manager'],
                'shift_str': f"WO (regular: {rs})",
                'ot_type': 'Full Day OT',
                'slot_key': k,
            })

            agent_wo_ot_count[shift['agent']] = wo_count + 1

    return candidates


def _compute_revised_heatmap_from_windows(original_data, windows):
    """Compute revised heatmap by adding +1 per recommendation to each interval
    covered by qualifying windows. Each recommendation represents one person
    covering that OT window."""
    # Build a map of adjustments: "date|program|lobby|interval" → headcount to add
    # Each window/recommendation = 1 person covering those intervals
    adjustments = {}

    for w in windows:
        for i in range(w['start_idx'], w['end_idx']):
            actual_idx = i % 48
            time_str = ALL_INTERVALS[actual_idx]
            key = f"{w['date']}|{w['program']}|{w['lobby']}|{time_str}"
            adjustments[key] = adjustments.get(key, 0) + 1

    result = []
    for row in original_data:
        key = (
            f"{row['date']}|{row['program']}|{row.get('lobby', '')}|"
            f"{row['intervalStartTime']}"
        )
        adj = adjustments.get(key)
        new_row = dict(row)
        if adj is not None:
            new_row['overUnderValue'] = row['overUnderValue'] + adj
        result.append(new_row)
    return result


def _produce_deficit_blocks(demand_windows):
    """Produce backward-compatible DeficitBlock records from demand windows.
    Groups contiguous demand windows by date+program into blocks."""
    blocks = []

    # Group by date+program+lobby
    grouped = {}
    for w in demand_windows:
        key = f"{w['date']}|{w['program']}|{w.get('lobby', '')}"
        grouped.setdefault(key, []).append(w)

    for windows in grouped.values():
        # Sort by startIdx
        sorted_windows = sorted(windows, key=lambda w: w['startIdx'])

        for w in sorted_windows:
            count = w['endIdx'] - w['startIdx']
            blocks.append({
                'date': w['date'],
                'program': w['program'],
                'startInterval': w['startInterval'],
                'endInterval': w['endInterval'],
                'count': count,
                'startIdx': w['startIdx'],
                'endIdx': w['endIdx'],
            })

    return blocks

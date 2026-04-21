"""
Auto OT slot generation logic.
Mirrors autoSlotGenerator.ts exactly.
"""
import re
from .slot_manager import create_slot_for_agent

ALL_INTERVALS = []
for i in range(48):
    h = str(i // 2).zfill(2)
    m = '00' if i % 2 == 0 else '30'
    ALL_INTERVALS.append(f"{h}:{m}")


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


def _overlaps_or_near(a1, a2, b1, b2, proximity=2):
    """Check if ranges [a1,a2) and [b1,b2) overlap or are within proximity intervals."""
    return a1 < b2 + proximity and b1 < a2 + proximity


def _shift_overlaps_deficit(shift_str, block_start_idx, block_end_idx):
    """Check if a regular shift time range overlaps a deficit block."""
    m = re.match(r'^(\d{2}:\d{2})-(\d{2}:\d{2})$', shift_str)
    if not m:
        return False
    ssi = _interval_index(m.group(1))
    sei = _interval_index(m.group(2))
    if sei <= ssi:
        sei += 48
    b_end = block_end_idx
    if b_end <= block_start_idx:
        b_end += 48
    return ssi < b_end and block_start_idx < sei


def generate_auto_slots(shifts, demand_windows, program):
    """Generate OT slots from demand windows and shift data.

    Args:
        shifts: list of shift entry dicts
        demand_windows: list of DemandWindow dicts with keys: date, program,
            lobby, startInterval, endInterval, startIdx, endIdx,
            averageDeficit, effectiveDemand, toleranceIntervalsUsed,
            shiftStart, shiftEnd
        program: str - the program identifier

    Returns:
        dict with keys: slots, summary, deficitBlocks, debug, recommendations
    """
    debug = []
    slots = []
    recommendations = []
    one_hr_pre = 0
    one_hr_post = 0
    two_hr_pre = 0
    two_hr_post = 0
    full_day = 0

    used_slot_keys = set()
    agent_wo_days = {}
    for s in shifts:
        if s.get('isWeeklyOff'):
            agent_wo_days.setdefault(s['agent'], []).append(s['date'])

    agent_wo_ot_count = {}
    agent_regular_shift = {}
    for s in shifts:
        if not s.get('isWeeklyOff') and s.get('shiftStart') and s.get('shiftEnd'):
            if s['agent'] not in agent_regular_shift:
                agent_regular_shift[s['agent']] = f"{s['shiftStart']}-{s['shiftEnd']}"

    def add_slot(params, rec):
        nonlocal slots, recommendations
        slots.append(create_slot_for_agent(params, rec['agent'], rec['agent']))
        recommendations.append(rec)

    # Build deficit blocks from demand windows for backward compatibility
    deficit_blocks = []
    for w in demand_windows:
        deficit_blocks.append({
            'date': w['date'],
            'program': w['program'],
            'startInterval': w['startInterval'],
            'endInterval': w['endInterval'],
            'count': w['endIdx'] - w['startIdx'],
            'startIdx': w['startIdx'],
            'endIdx': w['endIdx'],
        })

    for window in demand_windows:
        interval_count = window['endIdx'] - window['startIdx']
        debug.append(f"Window: {window['date']} {window['startInterval']}-{window['endInterval']} ({interval_count} intervals)")
        date_agents = [s for s in shifts if s['date'] == window['date']]
        working_agents = [s for s in date_agents if not s.get('isWeeklyOff') and s.get('shiftStart') and s.get('shiftEnd')]
        wo_agents = [s for s in date_agents if s.get('isWeeklyOff')]

        # Initialize deficit tracker for headcount-aware assignment
        deficit_tracker = {}
        for i in range(window['startIdx'], window['endIdx']):
            interval = ALL_INTERVALS[i % 48]
            deficit_tracker[interval] = abs(window.get('averageDeficit', 0)) if window.get('averageDeficit', 0) < 0 else 0

        def has_remaining_deficit():
            for v in deficit_tracker.values():
                if v > 0:
                    return True
            return False

        def decrement_deficit(start_idx, end_idx):
            for i in range(start_idx, end_idx):
                interval = ALL_INTERVALS[i % 48]
                current = deficit_tracker.get(interval, 0)
                if current > 0:
                    deficit_tracker[interval] = current - 1

        # Pass 1: Working agents — pre/post shift OT (with proximity check)
        for shift in working_agents:
            if not has_remaining_deficit():
                break

            ssi = _interval_index(shift['shiftStart'])
            sei = _interval_index(shift['shiftEnd'])
            shift_str = f"{shift['shiftStart']}-{shift['shiftEnd']}"
            def_str = f"{window['startInterval']}-{window['endInterval']}"
            agent_lobby = shift.get('lobby', '')

            # 2hr Pre Shift
            pre2_s = ssi - 4
            pre2_e = ssi
            if pre2_s >= 0 and _overlaps_or_near(window['startIdx'], window['endIdx'], pre2_s, pre2_e):
                k = f"{window['date']}|{shift['agent']}|pre2|{shift['shiftStart']}"
                if k not in used_slot_keys and has_remaining_deficit():
                    tw = f"{_index_to_time(max(pre2_s, 0))}-{shift['shiftStart']}"
                    add_slot(
                        {'otType': '2hr Pre Shift OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': tw},
                        {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': shift_str, 'otType': '2hr Pre Shift OT', 'otTimeWindow': tw, 'deficitBlock': def_str},
                    )
                    two_hr_pre += 1
                    used_slot_keys.add(k)
                    decrement_deficit(pre2_s, pre2_e)
            else:
                # 1hr Pre Shift
                pre1_s = ssi - 2
                pre1_e = ssi
                if pre1_s >= 0 and _overlaps_or_near(window['startIdx'], window['endIdx'], pre1_s, pre1_e):
                    k = f"{window['date']}|{shift['agent']}|pre1|{shift['shiftStart']}"
                    if k not in used_slot_keys and has_remaining_deficit():
                        tw = f"{_index_to_time(max(pre1_s, 0))}-{shift['shiftStart']}"
                        add_slot(
                            {'otType': '1hr Pre Shift OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': tw},
                            {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': shift_str, 'otType': '1hr Pre Shift OT', 'otTimeWindow': tw, 'deficitBlock': def_str},
                        )
                        one_hr_pre += 1
                        used_slot_keys.add(k)
                        decrement_deficit(pre1_s, pre1_e)

            # 2hr Post Shift
            post2_s = sei
            post2_e = sei + 4
            if post2_e <= 48 and _overlaps_or_near(window['startIdx'], window['endIdx'], post2_s, post2_e):
                k = f"{window['date']}|{shift['agent']}|post2|{shift['shiftEnd']}"
                if k not in used_slot_keys and has_remaining_deficit():
                    tw = f"{shift['shiftEnd']}-{_index_to_time(min(post2_e, 48))}"
                    add_slot(
                        {'otType': '2hr Post Shift OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': tw},
                        {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': shift_str, 'otType': '2hr Post Shift OT', 'otTimeWindow': tw, 'deficitBlock': def_str},
                    )
                    two_hr_post += 1
                    used_slot_keys.add(k)
                    decrement_deficit(post2_s, post2_e)
            else:
                # 1hr Post Shift
                post1_s = sei
                post1_e = sei + 2
                if post1_e <= 48 and _overlaps_or_near(window['startIdx'], window['endIdx'], post1_s, post1_e):
                    k = f"{window['date']}|{shift['agent']}|post1|{shift['shiftEnd']}"
                    if k not in used_slot_keys and has_remaining_deficit():
                        tw = f"{shift['shiftEnd']}-{_index_to_time(min(post1_e, 48))}"
                        add_slot(
                            {'otType': '1hr Post Shift OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': tw},
                            {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': shift_str, 'otType': '1hr Post Shift OT', 'otTimeWindow': tw, 'deficitBlock': def_str},
                        )
                        one_hr_post += 1
                        used_slot_keys.add(k)
                        decrement_deficit(post1_s, post1_e)

        # Pass 2: WO agents → Full Day OT (with shift-overlap filter and headcount tracking)
        for shift in wo_agents:
            if not has_remaining_deficit():
                break

            k = f"{window['date']}|{shift['agent']}|fullday"
            wo_count = agent_wo_ot_count.get(shift['agent'], 0)
            total_wo = len(agent_wo_days.get(shift['agent'], []))
            if total_wo >= 2 and wo_count >= 1:
                debug.append(f"  Skipping {shift['agent']}: labor law WO limit")
                continue

            # Skip agents with no known regular shift
            rs = agent_regular_shift.get(shift['agent'])
            if not rs or not _shift_overlaps_deficit(rs, window['startIdx'], window['endIdx']):
                debug.append(f"  Skipping {shift['agent']}: regular shift {rs or 'unknown'} does not overlap deficit")
                continue

            if k not in used_slot_keys:
                agent_lobby = shift.get('lobby', '')
                add_slot(
                    {'otType': 'Full Day OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': rs},
                    {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': f"WO (regular: {rs})", 'otType': 'Full Day OT', 'otTimeWindow': rs, 'deficitBlock': f"{window['startInterval']}-{window['endInterval']}"},
                )
                full_day += 1
                used_slot_keys.add(k)
                agent_wo_ot_count[shift['agent']] = wo_count + 1
                # Decrement deficit for the WO agent's regular shift intervals that overlap the block
                rs_match = re.match(r'^(\d{2}:\d{2})-(\d{2}:\d{2})$', rs)
                if rs_match:
                    rs_si = _interval_index(rs_match.group(1))
                    rs_sei = _interval_index(rs_match.group(2))
                    if rs_sei <= rs_si:
                        rs_sei += 48
                    decrement_deficit(max(rs_si, window['startIdx']), min(rs_sei, window['endIdx']))

        # Fallback: 4+ intervals, WO agents only (with shift-overlap filter)
        if has_remaining_deficit() and interval_count >= 4:
            for shift in [s for s in date_agents if s.get('isWeeklyOff')]:
                if not has_remaining_deficit():
                    break

                wo_count = agent_wo_ot_count.get(shift['agent'], 0)
                total_wo = len(agent_wo_days.get(shift['agent'], []))
                if total_wo >= 2 and wo_count >= 1:
                    continue

                rs = agent_regular_shift.get(shift['agent'])
                if not rs or not _shift_overlaps_deficit(rs, window['startIdx'], window['endIdx']):
                    continue

                k = f"{window['date']}|{shift['agent']}|fullday_fb"
                if k not in used_slot_keys:
                    agent_lobby = shift.get('lobby', '')
                    add_slot(
                        {'otType': 'Full Day OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': rs},
                        {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': f"WO (regular: {rs})", 'otType': 'Full Day OT', 'otTimeWindow': rs, 'deficitBlock': f"{window['startInterval']}-{window['endInterval']}"},
                    )
                    full_day += 1
                    used_slot_keys.add(k)
                    agent_wo_ot_count[shift['agent']] = agent_wo_ot_count.get(shift['agent'], 0) + 1
                    # Decrement deficit for the WO agent's regular shift intervals that overlap the block
                    rs_match = re.match(r'^(\d{2}:\d{2})-(\d{2}:\d{2})$', rs)
                    if rs_match:
                        rs_si = _interval_index(rs_match.group(1))
                        rs_sei = _interval_index(rs_match.group(2))
                        if rs_sei <= rs_si:
                            rs_sei += 48
                        decrement_deficit(max(rs_si, window['startIdx']), min(rs_sei, window['endIdx']))

    return {
        'slots': slots,
        'summary': {
            'total': len(slots),
            'oneHrPre': one_hr_pre,
            'oneHrPost': one_hr_post,
            'twoHrPre': two_hr_pre,
            'twoHrPost': two_hr_post,
            'fullDay': full_day,
        },
        'deficitBlocks': deficit_blocks,
        'debug': debug,
        'recommendations': recommendations,
    }

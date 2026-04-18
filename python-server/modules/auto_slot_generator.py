"""
Auto OT slot generation logic.
Mirrors autoSlotGenerator.ts exactly.
"""
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


def _overlaps(a1, a2, b1, b2):
    return a1 < b2 and b1 < a2


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
        window_matched = False

        for shift in working_agents:
            ssi = _interval_index(shift['shiftStart'])
            sei = _interval_index(shift['shiftEnd'])
            shift_str = f"{shift['shiftStart']}-{shift['shiftEnd']}"
            def_str = f"{window['startInterval']}-{window['endInterval']}"
            agent_lobby = shift.get('lobby', '')

            # 2hr Pre Shift
            pre2_s = ssi - 4
            pre2_e = ssi
            if pre2_s >= 0 and _overlaps(window['startIdx'], window['endIdx'], pre2_s, pre2_e):
                k = f"{window['date']}|{shift['agent']}|pre2|{shift['shiftStart']}"
                if k not in used_slot_keys:
                    tw = f"{_index_to_time(max(pre2_s, 0))}-{shift['shiftStart']}"
                    add_slot(
                        {'otType': '2hr Pre Shift OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': tw},
                        {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': shift_str, 'otType': '2hr Pre Shift OT', 'otTimeWindow': tw, 'deficitBlock': def_str},
                    )
                    two_hr_pre += 1
                    used_slot_keys.add(k)
                    window_matched = True
            else:
                # 1hr Pre Shift
                pre1_s = ssi - 2
                pre1_e = ssi
                if pre1_s >= 0 and _overlaps(window['startIdx'], window['endIdx'], pre1_s, pre1_e):
                    k = f"{window['date']}|{shift['agent']}|pre1|{shift['shiftStart']}"
                    if k not in used_slot_keys:
                        tw = f"{_index_to_time(max(pre1_s, 0))}-{shift['shiftStart']}"
                        add_slot(
                            {'otType': '1hr Pre Shift OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': tw},
                            {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': shift_str, 'otType': '1hr Pre Shift OT', 'otTimeWindow': tw, 'deficitBlock': def_str},
                        )
                        one_hr_pre += 1
                        used_slot_keys.add(k)
                        window_matched = True

            # 2hr Post Shift
            post2_s = sei
            post2_e = sei + 4
            if post2_e <= 48 and _overlaps(window['startIdx'], window['endIdx'], post2_s, post2_e):
                k = f"{window['date']}|{shift['agent']}|post2|{shift['shiftEnd']}"
                if k not in used_slot_keys:
                    tw = f"{shift['shiftEnd']}-{_index_to_time(min(post2_e, 48))}"
                    add_slot(
                        {'otType': '2hr Post Shift OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': tw},
                        {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': shift_str, 'otType': '2hr Post Shift OT', 'otTimeWindow': tw, 'deficitBlock': def_str},
                    )
                    two_hr_post += 1
                    used_slot_keys.add(k)
                    window_matched = True
            else:
                # 1hr Post Shift
                post1_s = sei
                post1_e = sei + 2
                if post1_e <= 48 and _overlaps(window['startIdx'], window['endIdx'], post1_s, post1_e):
                    k = f"{window['date']}|{shift['agent']}|post1|{shift['shiftEnd']}"
                    if k not in used_slot_keys:
                        tw = f"{shift['shiftEnd']}-{_index_to_time(min(post1_e, 48))}"
                        add_slot(
                            {'otType': '1hr Post Shift OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': tw},
                            {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': shift_str, 'otType': '1hr Post Shift OT', 'otTimeWindow': tw, 'deficitBlock': def_str},
                        )
                        one_hr_post += 1
                        used_slot_keys.add(k)
                        window_matched = True

        # WO agents -> Full Day OT
        for shift in wo_agents:
            k = f"{window['date']}|{shift['agent']}|fullday"
            wo_count = agent_wo_ot_count.get(shift['agent'], 0)
            total_wo = len(agent_wo_days.get(shift['agent'], []))
            if total_wo >= 2 and wo_count >= 1:
                debug.append(f"  Skipping {shift['agent']}: labor law WO limit")
                continue
            if k not in used_slot_keys:
                rs = agent_regular_shift.get(shift['agent'], 'Full Day')
                agent_lobby = shift.get('lobby', '')
                add_slot(
                    {'otType': 'Full Day OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': rs},
                    {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': f"WO (regular: {rs})", 'otType': 'Full Day OT', 'otTimeWindow': rs, 'deficitBlock': f"{window['startInterval']}-{window['endInterval']}"},
                )
                full_day += 1
                used_slot_keys.add(k)
                agent_wo_ot_count[shift['agent']] = wo_count + 1
                window_matched = True

        if not window_matched and interval_count >= 4:
            for shift in [s for s in date_agents if s.get('isWeeklyOff')]:
                wo_count = agent_wo_ot_count.get(shift['agent'], 0)
                total_wo = len(agent_wo_days.get(shift['agent'], []))
                if total_wo >= 2 and wo_count >= 1:
                    continue
                k = f"{window['date']}|{shift['agent']}|fullday_fb"
                if k not in used_slot_keys:
                    rs = agent_regular_shift.get(shift['agent'], 'Full Day')
                    agent_lobby = shift.get('lobby', '')
                    add_slot(
                        {'otType': 'Full Day OT', 'date': window['date'], 'program': program, 'lobby': agent_lobby, 'timeWindow': rs},
                        {'date': window['date'], 'program': program, 'lobby': agent_lobby, 'agent': shift['agent'], 'manager': shift['manager'], 'shift': f"WO (regular: {rs})", 'otType': 'Full Day OT', 'otTimeWindow': rs, 'deficitBlock': f"{window['startInterval']}-{window['endInterval']}"},
                    )
                    full_day += 1
                    used_slot_keys.add(k)
                    agent_wo_ot_count[shift['agent']] = agent_wo_ot_count.get(shift['agent'], 0) + 1

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

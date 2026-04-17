"""
Access control: agent validation and eligibility.
Mirrors accessControl.ts exactly.
"""
from datetime import datetime


def _get_week(date_str):
    """Returns the ISO week string for a date, e.g. '2025-W15'."""
    d = datetime.strptime(date_str, '%Y-%m-%d')
    # Match the JS logic exactly: use UTC-based ISO week calculation
    # JS: date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek)
    day_of_week = d.isoweekday()  # Mon=1..Sun=7
    # In JS: getUTCDay() returns 0=Sun..6=Sat, then || 7 makes Sun=7
    # So dayOfWeek in JS is same as isoweekday() in Python
    import datetime as dt
    d2 = dt.date(d.year, d.month, d.day)
    iso_year, iso_week, _ = d2.isocalendar()
    return f"{iso_year}-W{str(iso_week).zfill(2)}"


def validate_agent_pickup(slots, slot_id, agent_id, roster):
    """Validates whether an agent can pick up a specific slot."""
    slot = next((s for s in slots if s['id'] == slot_id), None)
    if not slot:
        return {'valid': False, 'error': 'Slot not found.'}

    if slot['status'] != 'Released':
        return {'valid': False, 'error': 'This slot is no longer available.'}

    # 30-minute cutoff
    slot_start_time = slot['timeWindow'].split('-')[0].strip() if '-' in slot['timeWindow'] else None
    if slot_start_time:
        now = datetime.now()
        try:
            slot_dt = datetime.strptime(f"{slot['date']}T{slot_start_time}:00", '%Y-%m-%dT%H:%M:%S')
            diff_ms = (slot_dt - now).total_seconds() * 1000
            diff_minutes = diff_ms / (1000 * 60)
            if diff_minutes < 30:
                return {'valid': False, 'error': 'This slot can no longer be picked up (less than 30 minutes to start time).'}
        except ValueError:
            pass

    # Find agent's entries
    entries = roster.get('entries', [])
    agent_entries = [e for e in entries if e['agent'] == agent_id]
    if not agent_entries:
        return {'valid': False, 'error': 'Agent not found in roster.'}

    # Check program match
    agent_programs = list(set(e['program'] for e in agent_entries))
    if slot['program'] not in agent_programs:
        return {'valid': False, 'error': 'You are not eligible for this slot (program mismatch).'}

    # Check lobby match
    if slot.get('lobby'):
        agent_lobbies = list(set(e['lobby'] for e in agent_entries if e.get('lobby')))
        if agent_lobbies and slot['lobby'] not in agent_lobbies:
            return {'valid': False, 'error': 'You are not eligible for this slot (lobby mismatch).'}

    is_full_day = slot['otType'] == 'Full Day OT'

    if is_full_day:
        # Agent must have weekly off on that date
        date_entry = next((e for e in agent_entries if e['date'] == slot['date']), None)
        if not date_entry or not date_entry.get('isWeeklyOff'):
            return {'valid': False, 'error': 'Full Day OT is only available for agents with a weekly off on this date.'}

        # Max 1 Full Day OT per week when agent has 2+ weekly offs
        slot_week = _get_week(slot['date'])
        agent_wo_dates = [e['date'] for e in agent_entries if e.get('isWeeklyOff')]
        wo_in_week = len([d for d in agent_wo_dates if _get_week(d) == slot_week])

        if wo_in_week >= 2:
            filled_full_day_this_week = [
                s for s in slots
                if s['status'] == 'Filled'
                and s.get('filledByAgentId') == agent_id
                and s['otType'] == 'Full Day OT'
                and _get_week(s['date']) == slot_week
            ]
            if len(filled_full_day_this_week) >= 1:
                return {'valid': False, 'error': 'You have reached the maximum Full Day OT pickups for this week.'}
    else:
        # Pre/Post OT: slot's assigned agent must match requesting agent
        if slot.get('assignedAgentId') and slot['assignedAgentId'] != agent_id:
            return {'valid': False, 'error': 'This slot is assigned to a different agent.'}

        # Max 1 Pre/Post OT per agent per day
        filled_pre_post_today = [
            s for s in slots
            if s['status'] == 'Filled'
            and s.get('filledByAgentId') == agent_id
            and s['date'] == slot['date']
            and s['otType'] != 'Full Day OT'
        ]
        if len(filled_pre_post_today) >= 1:
            return {'valid': False, 'error': 'You already have a Pre/Post Shift OT pickup on this date.'}

    return {'valid': True}


def get_eligible_slots_for_agent(slots, agent_id, roster):
    """Returns eligible slots for an agent."""
    entries = roster.get('entries', [])
    agent_entries = [e for e in entries if e['agent'] == agent_id]
    if not agent_entries:
        return []

    agent_programs = set(e['program'] for e in agent_entries)
    agent_lobbies = set(e['lobby'] for e in agent_entries if e.get('lobby'))
    released_slots = [s for s in slots if s['status'] == 'Released']

    result = []
    for slot in released_slots:
        # Must match program
        if slot['program'] not in agent_programs:
            continue

        # Must match lobby
        if slot.get('lobby') and agent_lobbies and slot['lobby'] not in agent_lobbies:
            continue

        # 30-minute cutoff
        slot_start_time = slot['timeWindow'].split('-')[0].strip() if '-' in slot['timeWindow'] else None
        if slot_start_time:
            now = datetime.now()
            try:
                slot_dt = datetime.strptime(f"{slot['date']}T{slot_start_time}:00", '%Y-%m-%dT%H:%M:%S')
                diff_ms = (slot_dt - now).total_seconds() * 1000
                if diff_ms < 30 * 60 * 1000:
                    continue
            except ValueError:
                pass

        if slot['otType'] == 'Full Day OT':
            date_entry = next((e for e in agent_entries if e['date'] == slot['date']), None)
            if not date_entry or not date_entry.get('isWeeklyOff'):
                continue
        else:
            if slot.get('assignedAgentId') and slot['assignedAgentId'] != agent_id:
                continue

        result.append(slot)

    return result


def get_manager_programs(manager_name, roster):
    """Returns programs managed by a given manager."""
    programs = set()
    for entry in roster.get('entries', []):
        if entry.get('manager') == manager_name:
            programs.add(entry['program'])
    return list(programs)

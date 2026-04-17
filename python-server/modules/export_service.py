"""
CSV export service.
Mirrors exportService.ts exactly.
"""
from .fill_rate_calculator import get_week


def _escape_csv_field(field):
    s = str(field)
    if ',' in s or '"' in s or '\n' in s:
        return '"' + s.replace('"', '""') + '"'
    return s


def serialize_slots_to_csv(slots, roster):
    """Serializes slots to CSV string."""
    agent_to_manager = {}
    program_to_manager = {}
    for entry in roster.get('entries', []):
        if entry['agent'] not in agent_to_manager:
            agent_to_manager[entry['agent']] = entry['manager']
        if entry['program'] not in program_to_manager:
            program_to_manager[entry['program']] = entry['manager']

    headers = ['Date', 'Week', 'Program', 'OT_Type', 'Time_Window', 'Slot_Status', 'Assigned_Agent', 'Manager']

    rows = []
    for slot in slots:
        week = get_week(slot['date'])
        assigned_agent = slot.get('filledByAgentName') or slot.get('assignedAgentName') or ''
        manager = ''
        if slot.get('filledByAgentId'):
            manager = agent_to_manager.get(slot['filledByAgentId'], '')
        if not manager and slot.get('assignedAgentId'):
            manager = agent_to_manager.get(slot['assignedAgentId'], '')
        if not manager:
            manager = program_to_manager.get(slot['program'], '')

        row_data = [slot['date'], week, slot['program'], slot['otType'], slot['timeWindow'], slot['status'], assigned_agent, manager]
        rows.append(','.join(_escape_csv_field(f) for f in row_data))

    return '\n'.join([','.join(headers)] + rows)


def serialize_fill_rates_to_csv(fill_rates):
    """Serializes fill rates to CSV string."""
    headers = ['Grouping', 'Key', 'Total_Released', 'Total_Filled', 'Fill_Rate']
    rows = []

    # Overall
    o = fill_rates['overall']
    fr = str(o['fillRate']) if o['fillRate'] is not None else 'N/A'
    rows.append(','.join(_escape_csv_field(f) for f in ['Overall', 'All', str(o['totalReleased']), str(o['totalFilled']), fr]))

    # By Program
    for key, val in fill_rates.get('byProgram', {}).items():
        fr = str(val['fillRate']) if val['fillRate'] is not None else 'N/A'
        rows.append(','.join(_escape_csv_field(f) for f in ['Program', key, str(val['totalReleased']), str(val['totalFilled']), fr]))

    # By Manager
    for key, val in fill_rates.get('byManager', {}).items():
        fr = str(val['fillRate']) if val['fillRate'] is not None else 'N/A'
        rows.append(','.join(_escape_csv_field(f) for f in ['Manager', key, str(val['totalReleased']), str(val['totalFilled']), fr]))

    # By Date
    for key, val in fill_rates.get('byDate', {}).items():
        fr = str(val['fillRate']) if val['fillRate'] is not None else 'N/A'
        rows.append(','.join(_escape_csv_field(f) for f in ['Date', key, str(val['totalReleased']), str(val['totalFilled']), fr]))

    # By Week
    for key, val in fill_rates.get('byWeek', {}).items():
        fr = str(val['fillRate']) if val['fillRate'] is not None else 'N/A'
        rows.append(','.join(_escape_csv_field(f) for f in ['Week', key, str(val['totalReleased']), str(val['totalFilled']), fr]))

    return '\n'.join([','.join(headers)] + rows)

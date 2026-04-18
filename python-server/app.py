"""
ROC OT Scheduling Tool - Flask Backend
Functionally identical to the Node.js/Express server.
Designed for PythonAnywhere deployment (no WebSocket).
"""
import os
import getpass
import uuid
from datetime import datetime, date, timedelta

from flask import Flask, request, jsonify, send_from_directory, send_file, make_response
from flask_cors import CORS

from modules.heatmap_parser import parse_heatmap_csv
from modules.shift_parser import parse_shift_csv
from modules.auto_slot_generator import generate_auto_slots
from modules.demand_calculator import compute_demand
from modules.access_control import validate_agent_pickup, get_eligible_slots_for_agent, get_manager_programs
from modules.slot_manager import release_slots, cancel_slot, pickup_slot, return_slot
from modules.fill_rate_calculator import calculate_all_fill_rates
from modules.export_service import serialize_slots_to_csv

from storage.json_file_store import (
    save_heatmap_data, load_heatmap_data,
    save_roster_data, load_roster_data,
    save_slots, load_slots,
    save_session_meta, load_session_meta,
    save_revised_heatmap, load_revised_heatmap,
    save_recommendations, load_recommendations,
    clear_current_week,
)

app = Flask(__name__, static_folder=None)
CORS(app)

# Serve client static files
CLIENT_DIST = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'client', 'dist'))

WFM_PASSWORD = 'ROCWFM@101'


def _get_system_username():
    username = getpass.getuser()
    if '\\' in username:
        username = username.split('\\')[-1]
    return username.lower()


def _get_current_week_start():
    """Get the Sunday that starts the current week."""
    today = date.today()
    days_since_sunday = (today.weekday() + 1) % 7
    sun = today - timedelta(days=days_since_sunday)
    return sun.isoformat()


# ─── Auth Routes ───────────────────────────────────────────────────────────────

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    body = request.get_json(force=True, silent=True) or {}
    role = body.get('role')
    agent_id = body.get('agentId')
    manager_name = body.get('managerName')

    if not role:
        return jsonify({'success': False, 'error': 'Role is required.'}), 400

    if role == 'wfm':
        password = body.get('password', '')
        if password != WFM_PASSWORD:
            return jsonify({'success': False, 'error': 'Invalid WFM password.'}), 401
        return jsonify({
            'success': True,
            'token': str(uuid.uuid4()),
            'user': {'role': 'wfm', 'name': 'WFM User'},
        })

    roster = load_roster_data()
    if not roster:
        return jsonify({'success': False, 'error': 'No shift roster has been uploaded yet. Please contact WFM.'}), 400

    if role == 'agent':
        system_user = _get_system_username()
        login_id = system_user or (agent_id.lower() if agent_id else '')

        if not login_id:
            return jsonify({'success': False, 'error': 'Agent ID is required.'}), 400

        agent_entries = [e for e in roster['entries'] if e['agent'].lower() == login_id]
        if not agent_entries:
            return jsonify({
                'success': False,
                'error': f'Agent "{login_id}" not found in the roster. Your system login is "{system_user}". Please ensure the roster has your login ID as the Agent name.',
            }), 401

        first = agent_entries[0]
        return jsonify({
            'success': True,
            'token': str(uuid.uuid4()),
            'user': {
                'role': 'agent',
                'name': first['agent'],
                'agentId': first['agent'],
                'program': first['program'],
                'manager': first['manager'],
            },
        })

    if role == 'manager':
        if not manager_name:
            return jsonify({'success': False, 'error': 'Manager name is required.'}), 400

        if manager_name not in roster.get('managers', []):
            return jsonify({'success': False, 'error': 'Manager not found in the uploaded shift roster.'}), 401

        programs = get_manager_programs(manager_name, roster)
        return jsonify({
            'success': True,
            'token': str(uuid.uuid4()),
            'user': {
                'role': 'manager',
                'name': manager_name,
                'programs': programs,
            },
        })

    return jsonify({'success': False, 'error': 'Invalid role.'}), 400


@app.route('/api/auth/managers', methods=['GET'])
def auth_managers():
    roster = load_roster_data()
    if not roster:
        return jsonify({'managers': []})
    return jsonify({'managers': roster.get('managers', [])})


# ─── Heatmap Routes ────────────────────────────────────────────────────────────

def _merge_heatmap_data(existing, incoming):
    """Merges new heatmap rows into existing data. Keyed by date|program|lobby|interval."""
    merged = {}
    for row in existing:
        key = f"{row['date']}|{row['program']}|{row['lobby']}|{row['intervalStartTime']}"
        merged[key] = row
    for row in incoming:
        key = f"{row['date']}|{row['program']}|{row['lobby']}|{row['intervalStartTime']}"
        merged[key] = row
    result = list(merged.values())
    result.sort(key=lambda r: (r['date'], r['program'], r['intervalStartTime']))
    return result


@app.route('/api/heatmap', methods=['POST'])
def upload_heatmap():
    try:
        body = request.get_json(force=True, silent=True) or {}
        csv_string = body.get('csv')

        if not csv_string or not isinstance(csv_string, str):
            return jsonify({'error': 'Please upload a valid CSV file.'}), 400

        if not csv_string.strip():
            return jsonify({'error': 'The uploaded file contains no data rows.'}), 400

        result = parse_heatmap_csv(csv_string)

        if result['errors'] and not result['valid']:
            return jsonify({'error': '; '.join(e.get('message', str(e)) for e in result['errors'])}), 400

        if not result['valid']:
            return jsonify({'error': 'The uploaded file contains no data rows.'}), 400

        week_start = _get_current_week_start()
        past_rows = [r for r in result['valid'] if r['date'] < week_start]
        future_rows = [r for r in result['valid'] if r['date'] >= week_start]

        if not future_rows:
            return jsonify({
                'error': f"All {len(past_rows)} rows contain dates before the current week ({week_start}). Only current and future week data can be uploaded.",
            }), 400

        existing = load_heatmap_data()
        merged = _merge_heatmap_data(existing, future_rows)
        save_heatmap_data(merged)

        save_slots([])
        save_recommendations([])
        save_revised_heatmap([])

        meta = load_session_meta() or {
            'createdAt': datetime.utcnow().isoformat() + 'Z',
            'lastUploadAt': None,
            'heatmapUploaded': False,
            'rosterUploaded': False,
        }
        meta['heatmapUploaded'] = True
        meta['lastUploadAt'] = datetime.utcnow().isoformat() + 'Z'
        save_session_meta(meta)

        return jsonify({
            'success': True,
            'rowCount': len(future_rows),
            'totalRows': len(merged),
            'skippedPastRows': len(past_rows),
            'errors': result['errors'],
        })
    except Exception as ex:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(ex)}'}), 500


@app.route('/api/heatmap', methods=['GET'])
def get_heatmap():
    heatmap = load_heatmap_data()
    revised = load_revised_heatmap()
    return jsonify({'heatmap': heatmap, 'revised': revised})


# ─── Roster Routes ─────────────────────────────────────────────────────────────

def _merge_roster_data(existing, incoming):
    """Merges new roster entries into existing data. Keyed by agent+date."""
    if not existing:
        return incoming

    merged = {}
    for e in existing.get('entries', []):
        key = f"{e['agent'].lower()}|{e['date']}"
        merged[key] = e
    for e in incoming.get('entries', []):
        key = f"{e['agent'].lower()}|{e['date']}"
        merged[key] = e

    entries = sorted(merged.values(), key=lambda e: (e['agent'], e['date']))
    agents = sorted(set(e['agent'] for e in entries))
    managers = sorted(set(e['manager'] for e in entries if e.get('manager')))
    programs = sorted(set(e['program'] for e in entries if e.get('program')))
    lobbies = sorted(set(e['lobby'] for e in entries if e.get('lobby')))
    dates = sorted(set(e['date'] for e in entries))

    return {'entries': entries, 'agents': agents, 'managers': managers, 'programs': programs, 'lobbies': lobbies, 'dates': dates}


@app.route('/api/roster', methods=['POST'])
def upload_roster():
    try:
        body = request.get_json(force=True, silent=True) or {}
        csv_string = body.get('csv')

        if not csv_string or not isinstance(csv_string, str):
            return jsonify({'error': 'Please upload a valid CSV file.'}), 400

        if not csv_string.strip():
            return jsonify({'error': 'The uploaded file contains no data rows.'}), 400

        parsed = parse_shift_csv(csv_string)
        roster = parsed['roster']
        errors = parsed['errors']

        if errors and not roster['entries']:
            return jsonify({'error': '; '.join(e.get('message', str(e)) for e in errors)}), 400

        week_start = _get_current_week_start()
        past_entries = [e for e in roster['entries'] if e['date'] < week_start]
        future_entries = [e for e in roster['entries'] if e['date'] >= week_start]

        if not future_entries:
            return jsonify({
                'error': f"All {len(past_entries)} entries contain dates before the current week ({week_start}). Only current and future week data can be uploaded.",
            }), 400

        filtered_roster = {
            'entries': future_entries,
            'agents': sorted(set(e['agent'] for e in future_entries)),
            'managers': sorted(set(e['manager'] for e in future_entries if e.get('manager'))),
            'programs': sorted(set(e['program'] for e in future_entries if e.get('program'))),
            'lobbies': sorted(set(e['lobby'] for e in future_entries if e.get('lobby'))),
            'dates': sorted(set(e['date'] for e in future_entries)),
        }

        existing = load_roster_data()
        merged = _merge_roster_data(existing, filtered_roster)
        save_roster_data(merged)

        save_slots([])
        save_recommendations([])
        save_revised_heatmap([])

        meta = load_session_meta() or {
            'createdAt': datetime.utcnow().isoformat() + 'Z',
            'lastUploadAt': None,
            'heatmapUploaded': False,
            'rosterUploaded': False,
        }
        meta['rosterUploaded'] = True
        meta['lastUploadAt'] = datetime.utcnow().isoformat() + 'Z'
        save_session_meta(meta)

        return jsonify({
            'success': True,
            'entryCount': len(future_entries),
            'totalEntries': len(merged['entries']),
            'skippedPastEntries': len(past_entries),
            'errors': errors,
        })
    except Exception as ex:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(ex)}'}), 500


@app.route('/api/roster', methods=['GET'])
def get_roster():
    roster = load_roster_data()
    if not roster:
        return jsonify({'agents': [], 'managers': [], 'programs': [], 'lobbies': [], 'entries': []})
    return jsonify({
        'agents': roster.get('agents', []),
        'managers': roster.get('managers', []),
        'programs': roster.get('programs', []),
        'lobbies': roster.get('lobbies', []),
        'entries': roster.get('entries', []),
    })


# ─── Generate Routes ───────────────────────────────────────────────────────────

@app.route('/api/generate', methods=['POST'])
def generate_slots():
    try:
        body = request.get_json(force=True, silent=True) or {}
        program = body.get('program')

        if not program:
            return jsonify({'error': 'Program is required.'}), 400

        heatmap_data = load_heatmap_data()
        if not heatmap_data:
            return jsonify({'error': 'Heatmap data must be uploaded before generating slots.'}), 400

        roster = load_roster_data()
        if not roster:
            return jsonify({'error': 'Shift roster must be uploaded before generating slots.'}), 400

        week_start = _get_current_week_start()
        current_heatmap = [r for r in heatmap_data if r['date'] >= week_start]
        if not current_heatmap:
            return jsonify({'error': 'No heatmap data available for the current or future weeks.'}), 400

        program_shifts = [e for e in roster['entries'] if e['program'] == program and e['date'] >= week_start]
        if not program_shifts:
            return jsonify({'error': f'No shift roster data for {program} in the current or future weeks.'}), 400

        # Extract tolerance from request body (default -2)
        tolerance = body.get('tolerance', -2)

        # Compute demand using the unified demand calculator
        demand_result = compute_demand(current_heatmap, program_shifts, program, tolerance)

        # Generate OT slots from demand windows
        slot_result = generate_auto_slots(program_shifts, demand_result['demand_windows'], program)

        # Remove existing slots for this program, then add new ones
        existing_slots = load_slots()
        other_slots = [s for s in existing_slots if s['program'] != program]
        all_slots = other_slots + slot_result['slots']
        save_slots(all_slots)

        # Remove existing recommendations for this program, then add new ones
        existing_recs = load_recommendations()
        other_recs = [r for r in existing_recs if r['program'] != program]
        all_recs = other_recs + demand_result['recommendations']
        save_recommendations(all_recs)

        # Use revised heatmap from demand calculator (replaces compute_revised_heatmap)
        save_revised_heatmap(demand_result['revised_heatmap'])

        return jsonify({
            'success': True,
            'generated': len(slot_result['slots']),
            'summary': demand_result['summary'],
            'deficitBlocks': demand_result['deficit_blocks'],
        })
    except Exception as ex:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(ex)}'}), 500


# ─── Slots Routes ──────────────────────────────────────────────────────────────

@app.route('/api/slots', methods=['GET'])
def get_slots():
    slots = load_slots()
    role = request.args.get('role')
    agent_id = request.args.get('agentId')

    if role == 'agent' and agent_id:
        roster = load_roster_data()
        if not roster:
            return jsonify({'slots': []})
        eligible = get_eligible_slots_for_agent(slots, agent_id, roster)
        # Also include slots already picked up by this agent
        my_filled = [s for s in slots if s['status'] == 'Filled' and s.get('filledByAgentId') == agent_id]
        # Merge without duplicates
        eligible_ids = set(s['id'] for s in eligible)
        combined = eligible + [s for s in my_filled if s['id'] not in eligible_ids]
        return jsonify({'slots': combined})

    return jsonify({'slots': slots})


@app.route('/api/slots/release', methods=['POST'])
def release_slots_route():
    body = request.get_json(force=True, silent=True) or {}
    slot_ids = body.get('slotIds')

    if not slot_ids or not isinstance(slot_ids, list):
        return jsonify({'error': 'slotIds array is required.'}), 400

    slots = load_slots()

    # Handle "release all"
    if len(slot_ids) == 1 and slot_ids[0] == 'all':
        slot_ids = [s['id'] for s in slots if s['status'] == 'Created']

    try:
        slots = release_slots(slots, slot_ids)
        save_slots(slots)
        return jsonify({'success': True, 'released': len(slot_ids)})
    except (ValueError, Exception) as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/slots/cancel', methods=['POST'])
def cancel_slot_route():
    body = request.get_json(force=True, silent=True) or {}
    slot_id = body.get('slotId')

    if not slot_id:
        return jsonify({'error': 'slotId is required.'}), 400

    try:
        slots = load_slots()
        slots = cancel_slot(slots, slot_id)
        save_slots(slots)
        return jsonify({'success': True})
    except (ValueError, Exception) as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/slots/pickup', methods=['POST'])
def pickup_slot_route():
    body = request.get_json(force=True, silent=True) or {}
    slot_id = body.get('slotId')
    agent_id = body.get('agentId')
    agent_name = body.get('agentName', '')

    if not slot_id or not agent_id:
        return jsonify({'error': 'slotId and agentId are required.'}), 400

    roster = load_roster_data()
    if not roster:
        return jsonify({'error': 'No roster data available.'}), 400

    slots = load_slots()
    validation = validate_agent_pickup(slots, slot_id, agent_id, roster)
    if not validation['valid']:
        error_msg = validation.get('error', '')
        if 'no longer available' in error_msg:
            status_code = 409
        elif 'program mismatch' in error_msg:
            status_code = 403
        else:
            status_code = 400
        return jsonify({'error': error_msg}), status_code

    try:
        slots = pickup_slot(slots, slot_id, agent_id, agent_name or agent_id)
        save_slots(slots)
        return jsonify({'success': True})
    except (ValueError, Exception) as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/slots/pickup-all', methods=['POST'])
def pickup_all_route():
    body = request.get_json(force=True, silent=True) or {}
    agent_id = body.get('agentId')
    agent_name = body.get('agentName', '')

    if not agent_id:
        return jsonify({'error': 'agentId is required.'}), 400

    roster = load_roster_data()
    if not roster:
        return jsonify({'error': 'No roster data available.'}), 400

    slots = load_slots()
    eligible = get_eligible_slots_for_agent(slots, agent_id, roster)
    picked_up = 0
    skipped = []

    # Sort: Pre/Post shift first (by date), then Full Day OT
    sorted_eligible = sorted(eligible, key=lambda s: (1 if s['otType'] == 'Full Day OT' else 0, s['date']))

    for slot in sorted_eligible:
        validation = validate_agent_pickup(slots, slot['id'], agent_id, roster)
        if validation['valid']:
            try:
                slots = pickup_slot(slots, slot['id'], agent_id, agent_name or agent_id)
                picked_up += 1
            except Exception:
                skipped.append(f"{slot['date']} {slot['otType']}: pickup failed")
        else:
            skipped.append(f"{slot['date']} {slot['otType']}: {validation.get('error', '')}")

    if picked_up > 0:
        save_slots(slots)

    return jsonify({'success': True, 'pickedUp': picked_up, 'skipped': skipped})


@app.route('/api/slots/return', methods=['POST'])
def return_slot_route():
    body = request.get_json(force=True, silent=True) or {}
    slot_id = body.get('slotId')

    if not slot_id:
        return jsonify({'error': 'slotId is required.'}), 400

    try:
        slots = load_slots()
        # Debug: find the slot and log its status
        target = next((s for s in slots if s['id'] == slot_id), None)
        if not target:
            return jsonify({'error': f'Slot {slot_id} not found.'}), 400
        if target['status'] != 'Filled':
            return jsonify({'error': f'Slot status is "{target["status"]}", not "Filled". Cannot return.'}), 400
        slots = return_slot(slots, slot_id)
        save_slots(slots)
        return jsonify({'success': True})
    except (ValueError, Exception) as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/slots/export', methods=['GET'])
def export_slots():
    slots = load_slots()
    roster = load_roster_data()
    if not roster:
        return jsonify({'error': 'No roster data available.'}), 400
    csv_data = serialize_slots_to_csv(slots, roster)
    response = make_response(csv_data)
    response.headers['Content-Type'] = 'text/csv'
    response.headers['Content-Disposition'] = 'attachment; filename=ot_slots_export.csv'
    return response


# ─── Fill Rates Route ──────────────────────────────────────────────────────────

@app.route('/api/fillrates', methods=['GET'])
def get_fill_rates():
    slots = load_slots()
    roster = load_roster_data()
    if not roster:
        return jsonify({
            'overall': {'totalReleased': 0, 'totalFilled': 0, 'fillRate': None},
            'byProgram': {},
            'byManager': {},
            'byDate': {},
            'byWeek': {},
            'byProgramWeek': {},
            'byManagerWeek': {},
        })
    fill_rates = calculate_all_fill_rates(slots, roster)
    return jsonify(fill_rates)


# ─── Session Routes ────────────────────────────────────────────────────────────

@app.route('/api/session/clear', methods=['POST'])
def session_clear():
    clear_current_week()
    return jsonify({'success': True, 'message': 'Current week data cleared. Historical data preserved.'})


@app.route('/api/session/status', methods=['GET'])
def session_status():
    meta = load_session_meta()
    return jsonify({
        'hasData': meta is not None,
        'heatmapUploaded': meta.get('heatmapUploaded', False) if meta else False,
        'rosterUploaded': meta.get('rosterUploaded', False) if meta else False,
        'connectedClients': 0,
    })


# ─── System User Route ────────────────────────────────────────────────────────

@app.route('/api/system-user', methods=['GET'])
def system_user():
    username = getpass.getuser()
    if '\\' in username:
        username = username.split('\\')[-1]
    return jsonify({'username': username.lower()})


# ─── Static File Serving ──────────────────────────────────────────────────────

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_static(path):
    """Serve the React client from ../client/dist/"""
    if path and os.path.exists(os.path.join(CLIENT_DIST, path)):
        return send_from_directory(CLIENT_DIST, path)
    index_path = os.path.join(CLIENT_DIST, 'index.html')
    if os.path.exists(index_path):
        return send_file(index_path)
    return jsonify({'error': 'Client not built. Run npm run build in the client directory.'}), 404


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    print(f"Server running on http://0.0.0.0:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)

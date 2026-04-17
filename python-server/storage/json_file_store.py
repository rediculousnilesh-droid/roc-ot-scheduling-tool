"""
JSON file-based storage layer.
Mirrors the Node.js jsonFileStore.ts exactly.
"""
import os
import json

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
DATA_DIR = os.path.normpath(DATA_DIR)


def _ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def _file_path(name):
    return os.path.join(DATA_DIR, name)


def _write_json(name, data):
    _ensure_data_dir()
    with open(_file_path(name), 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _read_json(name, fallback=None):
    _ensure_data_dir()
    fp = _file_path(name)
    if not os.path.exists(fp):
        return fallback
    try:
        with open(fp, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return fallback


def save_heatmap_data(data):
    _write_json('heatmap.json', data)


def load_heatmap_data():
    return _read_json('heatmap.json', [])


def save_roster_data(roster):
    _write_json('roster.json', roster)


def load_roster_data():
    return _read_json('roster.json', None)


def save_slots(slots):
    _write_json('slots.json', slots)


def load_slots():
    return _read_json('slots.json', [])


def save_session_meta(meta):
    _write_json('session.json', meta)


def load_session_meta():
    return _read_json('session.json', None)


def save_revised_heatmap(data):
    _write_json('revised_heatmap.json', data)


def load_revised_heatmap():
    return _read_json('revised_heatmap.json', [])


def save_recommendations(recs):
    _write_json('recommendations.json', recs)


def load_recommendations():
    return _read_json('recommendations.json', [])


def clear_all():
    _ensure_data_dir()
    for f in os.listdir(DATA_DIR):
        if f.endswith('.json'):
            os.unlink(os.path.join(DATA_DIR, f))


def clear_current_week():
    """Clears only current-week data, preserving historical data. Week starts on Sunday."""
    from datetime import date, timedelta
    today = date.today()
    day = today.weekday()  # Monday=0, Sunday=6
    # Python weekday: Mon=0..Sun=6. We need Sunday start.
    # days_since_sunday: Sun=0, Mon=1, Tue=2, ...
    days_since_sunday = (day + 1) % 7
    sun = today - timedelta(days=days_since_sunday)
    week_start = sun.isoformat()  # YYYY-MM-DD

    # Filter heatmap
    heatmap = load_heatmap_data()
    historical_heatmap = [r for r in heatmap if r['date'] < week_start]
    save_heatmap_data(historical_heatmap)

    # Filter roster
    roster = load_roster_data()
    if roster:
        historical_entries = [e for e in roster['entries'] if e['date'] < week_start]
        if historical_entries:
            agents = sorted(set(e['agent'] for e in historical_entries))
            managers = sorted(set(e['manager'] for e in historical_entries if e.get('manager')))
            programs = sorted(set(e['program'] for e in historical_entries if e.get('program')))
            lobbies = sorted(set(e['lobby'] for e in historical_entries if e.get('lobby')))
            dates = sorted(set(e['date'] for e in historical_entries))
            save_roster_data({
                'entries': historical_entries,
                'agents': agents,
                'managers': managers,
                'programs': programs,
                'lobbies': lobbies,
                'dates': dates,
            })
        else:
            fp = os.path.join(DATA_DIR, 'roster.json')
            if os.path.exists(fp):
                os.unlink(fp)

    # Filter slots
    slots = load_slots()
    historical_slots = [s for s in slots if s['date'] < week_start]
    save_slots(historical_slots)

    # Filter recommendations
    recs = load_recommendations()
    historical_recs = [r for r in recs if r['date'] < week_start]
    save_recommendations(historical_recs)

    # Filter revised heatmap
    revised = load_revised_heatmap()
    historical_revised = [r for r in revised if r['date'] < week_start]
    save_revised_heatmap(historical_revised)

    # Reset session meta
    fp = os.path.join(DATA_DIR, 'session.json')
    if os.path.exists(fp):
        os.unlink(fp)

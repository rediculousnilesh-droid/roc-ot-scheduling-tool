"""
Revised heatmap computation.
Mirrors revisedHeatmap.ts exactly.
"""
import re

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


def compute_revised_heatmap(original_data, recommendations):
    """Computes a revised heatmap by adding OT headcount back to intervals
    covered by each OT recommendation.

    Uses a delta-based approach: builds a delta_map of adjustments from
    recommendations, then applies them to the original data. Handles
    'Full Day' time windows by covering all 48 intervals.
    """
    delta_map = {}

    for rec in recommendations:
        time_window = rec.get('otTimeWindow', '')

        if time_window == 'Full Day':
            start_idx = 0
            end_idx = 48
        else:
            match = re.match(r'^(\d{2}:\d{2})-(\d{2}:\d{2})$', time_window)
            if not match:
                continue
            start_idx = _interval_index(match.group(1))
            end_idx = _interval_index(match.group(2))
            if end_idx <= start_idx:
                end_idx += 48

        for i in range(start_idx, end_idx):
            actual_idx = i % 48
            interval = ALL_INTERVALS[actual_idx]
            key = f"{rec['date']}|{rec['program']}|{interval}"
            delta_map[key] = delta_map.get(key, 0) + 1

    result = []
    for row in original_data:
        key = f"{row['date']}|{row['program']}|{row['intervalStartTime']}"
        delta = delta_map.get(key, 0)
        new_row = dict(row)
        new_row['overUnderValue'] = row['overUnderValue'] + delta
        result.append(new_row)
    return result

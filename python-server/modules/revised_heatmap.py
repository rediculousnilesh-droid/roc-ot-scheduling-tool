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
    covered by each OT recommendation."""
    data_map = {}
    for row in original_data:
        key = f"{row['date']}|{row['program']}|{row['intervalStartTime']}"
        data_map[key] = row['overUnderValue']

    for rec in recommendations:
        time_window = rec.get('otTimeWindow', '')
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
            if key in data_map:
                data_map[key] = data_map[key] + 1

    result = []
    for row in original_data:
        key = f"{row['date']}|{row['program']}|{row['intervalStartTime']}"
        new_row = dict(row)
        new_row['overUnderValue'] = data_map.get(key, row['overUnderValue'])
        result.append(new_row)
    return result

/**
 * Returns a color for an over/under value.
 * Negative → red shades (understaffing)
 * Positive → green shades (overstaffing)
 * Zero → neutral gray
 */
export function overUnderColor(value: number): string {
  if (value < 0) {
    const intensity = Math.min(Math.abs(value) / 10, 1);
    const r = 255;
    const g = Math.round(255 * (1 - intensity * 0.8));
    const b = Math.round(255 * (1 - intensity * 0.8));
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (value > 0) {
    const intensity = Math.min(value / 10, 1);
    const r = Math.round(255 * (1 - intensity * 0.8));
    const g = 255;
    const b = Math.round(255 * (1 - intensity * 0.8));
    return `rgb(${r}, ${g}, ${b})`;
  }
  return 'rgb(220, 220, 220)';
}

/**
 * Returns a color for a fill rate percentage.
 * 0% → red, 50% → yellow, 100% → green
 * null → gray (N/A)
 */
export function fillRateColor(rate: number | null): string {
  if (rate === null) {
    return 'rgb(200, 200, 200)';
  }
  const clamped = Math.max(0, Math.min(100, rate));
  if (clamped <= 50) {
    const t = clamped / 50;
    const r = 255;
    const g = Math.round(255 * t);
    return `rgb(${r}, ${g}, 0)`;
  }
  const t = (clamped - 50) / 50;
  const r = Math.round(255 * (1 - t));
  const g = 255;
  return `rgb(${r}, ${g}, 0)`;
}

/**
 * Simple color for heatmap cells based on the user's spec:
 * >+1 light green, <-1 light red, -1 to +1 light yellow
 */
export function heatmapCellColor(value: number): string {
  if (value > 1) return '#c6efce'; // light green
  if (value < -1) return '#ffc7ce'; // light red
  return '#ffeb9c'; // light yellow
}

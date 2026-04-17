import type { HeatmapRow } from '../types';
import HeatmapGrid from './HeatmapGrid';
import styles from './FillRateHeatmap.module.css';

interface Props {
  original: HeatmapRow[];
  revised: HeatmapRow[];
  programs?: string[];
  lobbies?: string[];
  threshold?: number;
}

export default function FillRateHeatmap({ original, revised, programs, lobbies }: Props) {
  return (
    <div className={styles.container}>
      <HeatmapGrid data={original} title="Before OT" programs={programs} lobbies={lobbies} />
      <HeatmapGrid data={revised} title="After OT" programs={programs} lobbies={lobbies} />
    </div>
  );
}

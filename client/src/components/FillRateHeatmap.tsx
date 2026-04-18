import type { HeatmapRow } from '../types';
import HeatmapGrid from './HeatmapGrid';
import styles from './FillRateHeatmap.module.css';

interface Props {
  original: HeatmapRow[];
  revised: HeatmapRow[];
  demandRevised?: HeatmapRow[];
  programs?: string[];
  lobbies?: string[];
  threshold?: number;
}

export default function FillRateHeatmap({ original, revised, demandRevised, programs, lobbies }: Props) {
  return (
    <div className={styles.container}>
      <HeatmapGrid data={original} title="Before OT" programs={programs} lobbies={lobbies} />
      {demandRevised && demandRevised.length > 0 && (
        <HeatmapGrid data={demandRevised} title="After Recommended OT (Demand)" programs={programs} lobbies={lobbies} />
      )}
      {revised.length > 0 && (
        <HeatmapGrid data={revised} title="After Actual OT (Garnered)" programs={programs} lobbies={lobbies} />
      )}
    </div>
  );
}

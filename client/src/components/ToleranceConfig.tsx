import styles from './ToleranceConfig.module.css';

interface Props {
  value: number;
  onChange: (val: number) => void;
}

export default function ToleranceConfig({ value, onChange }: Props) {
  return (
    <div className={styles.container}>
      <label>Tolerance (acceptable deficit per interval):</label>
      <input
        className={styles.slider}
        type="range"
        min={-2}
        max={-1}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={styles.value}>{value.toFixed(1)}</span>
    </div>
  );
}

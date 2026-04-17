import styles from './ThresholdConfig.module.css';

interface Props {
  value: number;
  onChange: (val: number) => void;
}

export default function ThresholdConfig({ value, onChange }: Props) {
  return (
    <div className={styles.container}>
      <label>Understaffing Threshold:</label>
      <input
        className={styles.input}
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

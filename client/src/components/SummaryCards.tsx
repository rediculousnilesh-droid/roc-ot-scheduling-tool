import { useMemo } from 'react';
import type { OTSlot, AllFillRates } from '../types';
import SlotNumber from './SlotNumber';
import styles from './SummaryCards.module.css';

interface Props {
  slots: OTSlot[];
  fillRates: AllFillRates | null;
  animKey?: number;
}

export default function SummaryCards({ slots, fillRates, animKey = 0 }: Props) {
  const created = slots.length;
  const released = slots.filter((s) => s.status === 'Released' || s.status === 'Filled').length;
  const filled = slots.filter((s) => s.status === 'Filled').length;
  const rate = fillRates?.overall?.fillRate;

  const cards = useMemo(() => [
    { label: 'Total Created', value: created },
    { label: 'Total Released', value: released },
    { label: 'Total Filled', value: filled },
  ], [created, released, filled]);

  return (
    <div className={styles.container}>
      {cards.map((c, i) => (
        <div key={c.label} className={styles.card}>
          <div className={styles.label}>{c.label}</div>
          <div className={styles.value}>
            {c.value > 0 && animKey > 0 ? (
              <SlotNumber value={c.value} delay={i * 200} animKey={animKey} />
            ) : (
              c.value
            )}
          </div>
        </div>
      ))}
      <div className={styles.card}>
        <div className={styles.label}>Fill Rate</div>
        <div className={styles.value}>{rate != null ? `${rate}%` : 'N/A'}</div>
      </div>
    </div>
  );
}

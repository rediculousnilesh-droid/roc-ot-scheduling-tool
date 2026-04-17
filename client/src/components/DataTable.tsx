import { useMemo, useState } from 'react';
import type { OTRecommendation } from '../types';
import styles from './DataTable.module.css';

interface Props {
  data: OTRecommendation[];
}

type SortKey = keyof OTRecommendation;

export default function DataTable({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortAsc, setSortAsc] = useState(true);

  const columns: { key: SortKey; label: string }[] = [
    { key: 'date', label: 'Date' },
    { key: 'program', label: 'Program' },
    { key: 'agent', label: 'Agent' },
    { key: 'manager', label: 'Manager' },
    { key: 'shift', label: 'Shift' },
    { key: 'otType', label: 'OT Type' },
    { key: 'otTimeWindow', label: 'Time Window' },
    { key: 'deficitBlock', label: 'Deficit Block' },
  ];

  const sorted = useMemo(() => {
    const copy = [...data];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [data, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  if (!data.length) return <p style={{ fontSize: '0.85rem', color: '#888' }}>No recommendations</p>;

  return (
    <div className={styles.container}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} onClick={() => handleSort(col.key)}>
                {col.label} {sortKey === col.key ? (sortAsc ? '▲' : '▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.key}>{row[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

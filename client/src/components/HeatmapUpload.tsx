import { useRef, useState } from 'react';
import * as api from '../api/httpClient';
import { downloadCSV } from '../modules/csvDownload';
import type { ValidationError } from '../types';
import styles from './HeatmapUpload.module.css';

function downloadHeatmapSample() {
  const headers = ['Date', 'Program', 'Lobby', 'Interval_Start_Time', 'Over_Under_Value'];
  const rows = [
    ['4/5/2026', 'SCS', 'Lobby-A', '0:00', '-4.8'],
    ['4/5/2026', 'SCS', 'Lobby-A', '0:30', '-4.8'],
    ['4/5/2026', 'SCS', 'Lobby-B', '0:00', '3.3'],
    ['4/5/2026', 'SCS', 'Lobby-B', '0:30', '3.3'],
  ];
  downloadCSV(headers, rows, 'heatmap_sample.csv');
}

function downloadPivotSample() {
  const headers = ['Program', 'Lobby', 'Interval', '31-May', '1-Jun', '2-Jun'];
  const rows = [
    ['SCS', 'Lobby-A', '0000', '-4', '-7', '-12'],
    ['SCS', 'Lobby-A', '0030', '-4', '-7', '-12'],
    ['SCS', 'Lobby-B', '0000', '-2', '-3', '-5'],
    ['SCS', 'Lobby-B', '0030', '-2', '-3', '-5'],
  ];
  downloadCSV(headers, rows, 'heatmap_pivot_sample.csv');
}

export default function HeatmapUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrors([]);
    setMessage('');
    setUploading(true);
    try {
      const text = await file.text();
      const res = await api.uploadHeatmap(text) as { success: boolean; rowCount: number; skippedPastRows?: number; errors?: ValidationError[] };
      if (res.success) {
        let msg = `✓ Uploaded ${res.rowCount} rows`;
        if (res.skippedPastRows && res.skippedPastRows > 0) {
          msg += ` (⚠ ${res.skippedPastRows} past-week rows were skipped)`;
        }
        setMessage(msg);
      }
      if (res.errors?.length) {
        setErrors(res.errors);
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.uploadArea} onClick={() => fileRef.current?.click()}>
        <div className={styles.uploadIcon}>📊</div>
        <div className={styles.label}>
          {uploading ? 'Uploading…' : 'Upload Heatmap CSV'}
        </div>
        <div className={styles.hint}>Click to select file (standard or pivot format)</div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        className={styles.hidden}
        onChange={handleFile}
      />
      <div className={styles.sampleLinks}>
        <button className={styles.sampleBtn} onClick={downloadHeatmapSample}>📥 Standard Format Sample</button>
        <button className={styles.sampleBtn} onClick={downloadPivotSample}>📥 Pivot Format Sample</button>
      </div>
      {message && !errors.length && <p className={styles.success}>{message}</p>}
      {errors.length > 0 && (
        <div className={styles.errorList}>
          {errors.map((e, i) => (
            <div key={i}>Row {e.row}: {e.field} — {e.message}</div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useRef, useState } from 'react';
import * as api from '../api/httpClient';
import { downloadCSV } from '../modules/csvDownload';
import type { ValidationError } from '../types';
import styles from './HeatmapUpload.module.css';

function downloadRosterSample() {
  const headers = ['Agent', 'Program', 'Lobby', 'Manager', '4/14/2026', '4/15/2026', '4/16/2026', '4/17/2026'];
  const rows = [
    ['Agent001', 'SCS', 'Lobby-A', 'Manager1', '07:00-16:00', '07:00-16:00', 'WO', '08:00-17:00'],
    ['Agent002', 'SCS', 'Lobby-B', 'Manager1', '08:00-17:00', 'WO', '08:00-17:00', '08:00-17:00'],
    ['Agent003', 'RET', '', 'Manager2', '09:00-18:00', '09:00-18:00', '09:00-18:00', 'WO'],
  ];
  downloadCSV(headers, rows, 'shift_roster_sample.csv');
}

export default function ShiftRosterUpload() {
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
      const res = await api.uploadRoster(text) as { success: boolean; entryCount: number; skippedPastEntries?: number; errors?: ValidationError[] };
      if (res.success) {
        let msg = `✓ Uploaded ${res.entryCount} entries`;
        if (res.skippedPastEntries && res.skippedPastEntries > 0) {
          msg += ` (⚠ ${res.skippedPastEntries} past-week entries were skipped)`;
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
        <div className={styles.uploadIcon}>📋</div>
        <div className={styles.label}>
          {uploading ? 'Uploading…' : 'Upload Shift Roster CSV'}
        </div>
        <div className={styles.hint}>Click to select file</div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        className={styles.hidden}
        onChange={handleFile}
      />
      <div className={styles.sampleLinks}>
        <button className={styles.sampleBtn} onClick={downloadRosterSample}>📥 Download Sample Format</button>
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

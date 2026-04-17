import { useState, useMemo } from 'react';
import type { OTSlot, ShiftEntry } from '../types';
import * as api from '../api/httpClient';
import styles from './AvailableSlots.module.css';

interface Props {
  slots: OTSlot[];
  agentId: string;
  agentName: string;
  shiftEntries?: ShiftEntry[];
  onRefresh?: () => void;
}

function fmtDate(d: string): string {
  const p = d.split('-');
  if (p.length !== 3) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(p[2])}-${months[parseInt(p[1]) - 1]}`;
}

interface SlotGroup {
  otType: string;
  timeWindow: string;
  date: string;
  available: number;
  myPickup: OTSlot | null;
  firstAvailableId: string | null;
}

export default function AvailableSlots({ slots, agentId, agentName, shiftEntries, onRefresh }: Props) {
  const [message, setMessage] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMessage(text); setMsgType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  // Build a map of date -> shift info for this agent
  const shiftByDate = useMemo(() => {
    const map = new Map<string, string>();
    if (!shiftEntries) return map;
    const agentLower = agentId.toLowerCase();
    for (const e of shiftEntries) {
      if (e.agent.toLowerCase() !== agentLower) continue;
      if (e.isWeeklyOff) {
        map.set(e.date, 'WO');
      } else if (e.shiftStart && e.shiftEnd) {
        map.set(e.date, `${e.shiftStart}-${e.shiftEnd}`);
      }
    }
    return map;
  }, [shiftEntries, agentId]);

  const groups = useMemo(() => {
    const map = new Map<string, SlotGroup>();
    for (const s of slots) {
      const isAvailable = s.status === 'Released';
      const isMyPickup = s.status === 'Filled' && s.filledByAgentId === agentId;
      if (!isAvailable && !isMyPickup) continue;

      const key = `${s.otType}|${s.timeWindow}|${s.date}`;
      const g = map.get(key);
      if (g) {
        if (isAvailable) { g.available++; if (!g.firstAvailableId) g.firstAvailableId = s.id; }
        if (isMyPickup) g.myPickup = s;
      } else {
        map.set(key, {
          otType: s.otType, timeWindow: s.timeWindow, date: s.date,
          available: isAvailable ? 1 : 0,
          myPickup: isMyPickup ? s : null,
          firstAvailableId: isAvailable ? s.id : null,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.otType.localeCompare(b.otType));
  }, [slots, agentId]);

  const handlePickup = async (slotId: string) => {
    try {
      await api.pickupSlot(slotId, agentId, agentName);
      showMsg('✓ Slot picked up successfully', 'success');
      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Pickup failed', 'error');
    }
  };

  const handlePickupAll = async () => {
    try {
      const res = await api.pickupAllSlots(agentId, agentName);
      if (res.pickedUp > 0) {
        let msg = `✓ Picked up ${res.pickedUp} slot${res.pickedUp > 1 ? 's' : ''}`;
        if (res.skipped.length > 0) {
          msg += ` (${res.skipped.length} skipped due to rules)`;
        }
        showMsg(msg, 'success');
        if (onRefresh) onRefresh();
      } else {
        showMsg('No eligible slots to pick up', 'error');
      }
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Pickup all failed', 'error');
    }
  };

  const handleReturn = async (slotId: string) => {
    try {
      await api.returnSlot(slotId);
      showMsg('✓ Slot returned', 'success');
      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      showMsg(err instanceof Error ? err.message : 'Return failed', 'error');
    }
  };

  if (!groups.length) return <p className={styles.empty}>No available OT slots for you right now.</p>;

  const hasAvailable = groups.some((g) => g.firstAvailableId && !g.myPickup);

  return (
    <div className={styles.container}>
      {message && (
        <div className={`${styles.message} ${msgType === 'success' ? styles.success : styles.error}`}>{message}</div>
      )}
      {hasAvailable && (
        <div style={{ marginBottom: '0.75rem' }}>
          <button className={styles.btnPickupAll} onClick={handlePickupAll}>
            ⚡ Pick Up All Available Slots
          </button>
        </div>
      )}
      <table className={styles.table}>
        <thead className={styles.tableHead}>
          <tr>
            <th className={styles.th}>OT Type</th>
            <th className={styles.th}>Date</th>
            <th className={styles.th}>My Shift</th>
            <th className={styles.th}>OT Time Window</th>
            <th className={styles.thCenter}>Available</th>
            <th className={styles.thCenter}>My Status</th>
            <th className={styles.thCenter}>Action</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => {
            const shift = shiftByDate.get(g.date) || '—';
            return (
              <tr key={i} className={styles.tr}>
                <td className={styles.td}>{g.otType}</td>
                <td className={styles.td}>{fmtDate(g.date)}</td>
                <td className={styles.td}>
                  <span className={shift === 'WO' ? styles.badgeWO : styles.badgeShift}>
                    {shift}
                  </span>
                </td>
                <td className={styles.td}>{g.timeWindow}</td>
                <td className={styles.tdCenter}>
                  <span className={styles.availCount}>{g.available}</span>
                </td>
                <td className={styles.tdCenter}>
                  {g.myPickup ? (
                    <span className={styles.badgePicked}>Picked Up</span>
                  ) : '—'}
                </td>
                <td className={styles.tdCenter}>
                  {g.myPickup ? (
                    <button className={styles.btnReturn} onClick={() => handleReturn(g.myPickup!.id)}>Return</button>
                  ) : g.firstAvailableId ? (
                    <button className={styles.btnPickup} onClick={() => handlePickup(g.firstAvailableId!)}>Pick Up</button>
                  ) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import { useState } from 'react';
import type { OTSlot } from '../types';
import * as api from '../api/httpClient';

interface Props {
  slots: OTSlot[];
  agentId: string;
}

function fmtDate(d: string): string {
  const p = d.split('-');
  if (p.length !== 3) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(p[2])}-${months[parseInt(p[1]) - 1]}`;
}

export default function MyPickups({ slots, agentId }: Props) {
  const [message, setMessage] = useState('');

  const pickups = slots.filter((s) => s.status === 'Filled' && s.filledByAgentId === agentId);

  const handleReturn = async (slotId: string) => {
    if (!confirm('Return this OT slot?')) return;
    try {
      await api.returnSlot(slotId);
      setMessage('Slot returned');
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Return failed');
    }
    setTimeout(() => setMessage(''), 3000);
  };

  if (!pickups.length) return <p style={{ fontSize: 13, color: '#94a3b8' }}>No pickups yet.</p>;

  return (
    <div>
      {message && <div style={{ fontSize: 12, padding: 6, marginBottom: 6, background: '#fef3c7', borderRadius: 4 }}>{message}</div>}
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #cbd5e1' }}>OT Type</th>
            <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #cbd5e1' }}>Date</th>
            <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #cbd5e1' }}>Time Window</th>
            <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #cbd5e1' }}>Picked Up</th>
            <th style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '2px solid #cbd5e1' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {pickups.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '5px 10px' }}>{s.otType}</td>
              <td style={{ padding: '5px 10px' }}>{fmtDate(s.date)}</td>
              <td style={{ padding: '5px 10px' }}>{s.timeWindow}</td>
              <td style={{ padding: '5px 10px', fontSize: 11, color: '#64748b' }}>{s.filledAt ? new Date(s.filledAt).toLocaleString() : ''}</td>
              <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                <button style={{ padding: '2px 8px', fontSize: 11, background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 3, cursor: 'pointer' }}
                  onClick={() => handleReturn(s.id)}>Return</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

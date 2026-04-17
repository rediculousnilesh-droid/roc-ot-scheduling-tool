import { useState, useEffect } from 'react';
import * as api from '../api/httpClient';
import type { LoginResponse } from '../types';
import styles from './LoginScreen.module.css';

interface Props {
  onLogin: (resp: LoginResponse) => void;
}

type Role = 'wfm' | 'agent' | 'manager';

export default function LoginScreen({ onLogin }: Props) {
  const [role, setRole] = useState<Role>('wfm');
  const [agentId, setAgentId] = useState('');
  const [systemUser, setSystemUser] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managers, setManagers] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getManagers().then((r) => {
      setManagers(r.managers || []);
      if (r.managers?.length) setManagerName(r.managers[0]);
    }).catch(() => {});

    // Auto-detect system username
    api.getSystemUser()
      .then((r) => {
        if (r.username) {
          setSystemUser(r.username);
          setAgentId(r.username);
        }
      })
      .catch(() => {
        // Detection failed — leave field editable
        setSystemUser('');
      });
  }, []);

  // When role switches to agent, auto-fill with system user
  useEffect(() => {
    if (role === 'agent' && systemUser) {
      setAgentId(systemUser);
    }
  }, [role, systemUser]);

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const resp = await api.login({
        role,
        ...(role === 'agent' ? { agentId } : {}),
        ...(role === 'manager' ? { managerName } : {}),
      });
      if (resp.success) {
        if (resp.token) sessionStorage.setItem('token', resp.token);
        onLogin(resp);
      } else {
        setError(resp.error || 'Login failed');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.orb1} />
      <div className={styles.orb2} />
      <div className={styles.orb3} />
      {/* Road line */}
      <div className={styles.road} />
      {/* Delivery van */}
      <div className={styles.van}>
        <svg viewBox="0 0 120 50" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="50">
          {/* Van body */}
          <rect x="0" y="10" width="75" height="30" rx="3" fill="#232f3e"/>
          {/* Cargo area */}
          <rect x="2" y="12" width="50" height="26" rx="2" fill="#37475a"/>
          {/* Smile arrow on cargo */}
          <path d="M15 28 Q27 34 39 28" stroke="#ff9900" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          <path d="M36 22 L39 28 L33 28" fill="#ff9900"/>
          {/* Cabin */}
          <rect x="55" y="5" width="35" height="35" rx="4" fill="#232f3e"/>
          {/* Windshield */}
          <rect x="62" y="9" width="24" height="16" rx="2" fill="#6cb4ee" opacity="0.7"/>
          {/* Headlight */}
          <rect x="87" y="28" width="5" height="6" rx="1" fill="#ffd700"/>
          {/* Bumper */}
          <rect x="85" y="36" width="10" height="4" rx="1" fill="#4a5568"/>
          {/* Wheels */}
          <circle cx="20" cy="42" r="8" fill="#1a202c"/>
          <circle cx="20" cy="42" r="4" fill="#4a5568"/>
          <circle cx="20" cy="42" r="1.5" fill="#a0aec0"/>
          <circle cx="72" cy="42" r="8" fill="#1a202c"/>
          <circle cx="72" cy="42" r="4" fill="#4a5568"/>
          <circle cx="72" cy="42" r="1.5" fill="#a0aec0"/>
        </svg>
      </div>
      {/* Second van (smaller, further back) */}
      <div className={styles.van2}>
        <svg viewBox="0 0 120 50" fill="none" xmlns="http://www.w3.org/2000/svg" width="80" height="34">
          <rect x="0" y="10" width="75" height="30" rx="3" fill="#232f3e" opacity="0.5"/>
          <rect x="2" y="12" width="50" height="26" rx="2" fill="#37475a" opacity="0.5"/>
          <path d="M15 28 Q27 34 39 28" stroke="#ff9900" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.5"/>
          <path d="M36 22 L39 28 L33 28" fill="#ff9900" opacity="0.5"/>
          <rect x="55" y="5" width="35" height="35" rx="4" fill="#232f3e" opacity="0.5"/>
          <rect x="62" y="9" width="24" height="16" rx="2" fill="#6cb4ee" opacity="0.35"/>
          <rect x="87" y="28" width="5" height="6" rx="1" fill="#ffd700" opacity="0.5"/>
          <circle cx="20" cy="42" r="8" fill="#1a202c" opacity="0.5"/>
          <circle cx="20" cy="42" r="4" fill="#4a5568" opacity="0.5"/>
          <circle cx="72" cy="42" r="8" fill="#1a202c" opacity="0.5"/>
          <circle cx="72" cy="42" r="4" fill="#4a5568" opacity="0.5"/>
        </svg>
      </div>
      <div className={styles.card}>
        <h2 className={styles.title}>ROC OT Scheduling Tool</h2>
        <div className={styles.roleGroup}>
          {(['wfm', 'agent', 'manager'] as Role[]).map((r) => (
            <button
              key={r}
              className={`${styles.roleBtn} ${role === r ? styles.roleBtnActive : ''}`}
              onClick={() => { setRole(r); setError(''); }}
            >
              {r === 'wfm' ? 'WFM' : r === 'agent' ? 'Agent' : 'Manager'}
            </button>
          ))}
        </div>

        {role === 'agent' && (
          <div className={styles.field}>
            <label className={styles.label}>Agent ID</label>
            {systemUser ? (
              <>
                <input
                  className={styles.input}
                  value={agentId}
                  readOnly
                  style={{ background: '#f1f5f9', cursor: 'not-allowed' }}
                />
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Auto-detected: {systemUser}
                </div>
              </>
            ) : (
              <input
                className={styles.input}
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="Enter your Agent ID"
              />
            )}
          </div>
        )}

        {role === 'manager' && (
          <div className={styles.field}>
            <label className={styles.label}>Manager Name</label>
            <select
              className={styles.select}
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
            >
              {managers.length === 0 && <option value="">No managers available</option>}
              {managers.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        <button
          className={styles.loginBtn}
          onClick={handleLogin}
          disabled={loading || (role === 'agent' && !agentId.trim()) || (role === 'manager' && !managerName)}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

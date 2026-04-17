import { useState, useEffect, useCallback } from 'react';
import type {
  LoginResponse,
  HeatmapRow,
  OTSlot,
  AllFillRates,
  OTRecommendation,
  ShiftEntry,
} from './types';
import * as api from './api/httpClient';
import * as socket from './api/socketClient';
import type { ConnectionState } from './api/socketClient';
import LoginScreen from './components/LoginScreen';
import ConnectionStatus from './components/ConnectionStatus';
import HeatmapUpload from './components/HeatmapUpload';
import ShiftRosterUpload from './components/ShiftRosterUpload';
import SlotManagement from './components/SlotManagement';
import AvailableSlots from './components/AvailableSlots';
import MyPickups from './components/MyPickups';
import Dashboard from './components/Dashboard';
import ManagerDashboard from './components/ManagerDashboard';
import styles from './App.module.css';

export default function App() {
  const [user, setUser] = useState<LoginResponse['user'] | null>(null);
  const [connStatus, setConnStatus] = useState<ConnectionState>('disconnected');

  // Global state
  const [heatmap, setHeatmap] = useState<HeatmapRow[]>([]);
  const [revised, setRevised] = useState<HeatmapRow[]>([]);
  const [programs, setPrograms] = useState<string[]>([]);
  const [managers, setManagers] = useState<string[]>([]);
  const [lobbies, setLobbies] = useState<string[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [slots, setSlots] = useState<OTSlot[]>([]);
  const [fillRates, setFillRates] = useState<AllFillRates | null>(null);
  const [recommendations, setRecommendations] = useState<OTRecommendation[]>([]);
  const [shiftEntries, setShiftEntries] = useState<ShiftEntry[]>([]);

  // WFM tabs
  const [activeTab, setActiveTab] = useState<'uploads' | 'slots' | 'dashboard'>('uploads');

  // Refresh data when switching tabs (needed when WebSocket isn't available)
  const handleTabChange = (tab: 'uploads' | 'slots' | 'dashboard') => {
    setActiveTab(tab);
    fetchAll();
  };

  const fetchAll = useCallback(async () => {
    try {
      const [hm, roster, slotsRes, fr] = await Promise.all([
        api.getHeatmap().catch(() => ({ heatmap: [], revised: [] })),
        api.getRoster().catch(() => ({ agents: [], managers: [], programs: [], entries: [] as ShiftEntry[] })),
        api.getSlots(user?.role, user?.agentId).catch(() => ({ slots: [] })),
        api.getFillRates().catch(() => null),
      ]);
      setHeatmap(hm.heatmap || []);
      setRevised(hm.revised || []);
      setPrograms(roster.programs || []);
      setManagers(roster.managers || []);
      setLobbies((roster as { lobbies?: string[] }).lobbies || []);
      setAgents(roster.agents || []);
      setShiftEntries(roster.entries || []);
      setSlots(slotsRes.slots || []);
      if (fr) setFillRates(fr);
    } catch {
      // ignore
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const s = socket.connect();

    const unsubs = [
      socket.onConnectionStatus((status) => {
        setConnStatus(status);
        if (status === 'connected') fetchAll();
      }),
      socket.onHeatmapUpdated((data) => {
        setHeatmap(data.heatmap || []);
        setRevised(data.revised || []);
      }),
      socket.onRosterUpdated(async (data) => {
        setPrograms(data.programs || []);
        setManagers(data.managers || []);
        setLobbies((data as { lobbies?: string[] }).lobbies || []);
        setAgents(data.agents || []);
        // Fetch full roster entries for shift data
        try {
          const roster = await api.getRoster();
          setShiftEntries(roster.entries || []);
        } catch { /* ignore */ }
      }),
      socket.onSlotsUpdated((data) => {
        setSlots(data.slots || []);
        if (data.fillRates) setFillRates(data.fillRates);
        if (data.recommendations) setRecommendations(data.recommendations);
      }),
      socket.onSessionCleared(() => {
        setHeatmap([]);
        setRevised([]);
        setSlots([]);
        setFillRates(null);
        setRecommendations([]);
        setPrograms([]);
        setManagers([]);
        setLobbies([]);
        setAgents([]);
      }),
    ];

    fetchAll();

    return () => {
      unsubs.forEach((u) => u());
      socket.disconnect();
    };
  }, [user, fetchAll]);

  const handleLogin = (resp: LoginResponse) => {
    setUser(resp.user);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('token');
    setUser(null);
    socket.disconnect();
  };

  const handleClear = async () => {
    try {
      await api.clearSession();
    } catch {
      // handled by socket event
    }
  };

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className={styles.app}>
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <span className={styles.appTitle}>ROC OT Scheduling Tool</span>
          <ConnectionStatus status={connStatus} />
        </div>
        <div className={styles.topBarRight}>
          <span className={styles.userInfo}>
            {user.role === 'wfm' ? 'WFM' : user.name} ({user.role})
          </span>
          {user.role === 'wfm' && (
            <button className={styles.clearBtn} onClick={handleClear}>
              Clear Current Week
            </button>
          )}
          <button className={styles.logoutBtn} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {/* WFM View */}
        {user.role === 'wfm' && (
          <>
            <div className={styles.tabs}>
              <button
                className={`${styles.tab} ${activeTab === 'uploads' ? styles.tabActive : ''}`}
                onClick={() => handleTabChange('uploads')}
              >
                Uploads
              </button>
              <button
                className={`${styles.tab} ${activeTab === 'slots' ? styles.tabActive : ''}`}
                onClick={() => handleTabChange('slots')}
              >
                Slot Management
              </button>
              <button
                className={`${styles.tab} ${activeTab === 'dashboard' ? styles.tabActive : ''}`}
                onClick={() => handleTabChange('dashboard')}
              >
                Dashboard
              </button>
            </div>

            {activeTab === 'uploads' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <HeatmapUpload />
                <ShiftRosterUpload />
              </div>
            )}

            {activeTab === 'slots' && (
              <SlotManagement slots={slots} shifts={shiftEntries} programs={programs} lobbies={lobbies} heatmap={heatmap} />
            )}

            {activeTab === 'dashboard' && (
              <Dashboard
                slots={slots}
                heatmap={heatmap}
                revised={revised}
                fillRates={fillRates}
                recommendations={recommendations}
                programs={programs}
                managers={managers}
                lobbies={lobbies}
              />
            )}
          </>
        )}

        {/* Agent View */}
        {user.role === 'agent' && (
          <>
            <AvailableSlots
              slots={slots}
              agentId={user.agentId || ''}
              agentName={user.name}
              shiftEntries={shiftEntries}
            />
            <MyPickups slots={slots} agentId={user.agentId || ''} />
          </>
        )}

        {/* Manager View */}
        {user.role === 'manager' && (
          <ManagerDashboard
            slots={slots}
            fillRates={fillRates}
            managerPrograms={user.programs || []}
            managerName={user.name}
          />
        )}
      </div>
    </div>
  );
}

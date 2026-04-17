import type { ConnectionState } from '../api/socketClient';
import styles from './ConnectionStatus.module.css';

interface Props {
  status: ConnectionState;
}

const labels: Record<ConnectionState, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting…',
};

export default function ConnectionStatus({ status }: Props) {
  // Don't show reconnecting/disconnected status — WebSocket may not be available (e.g., PythonAnywhere)
  if (status !== 'connected') return null;

  return (
    <span className={`${styles.indicator} ${styles[status]}`}>
      <span className={styles.dot} />
      {labels[status]}
    </span>
  );
}

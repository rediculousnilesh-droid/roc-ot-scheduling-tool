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
  return (
    <span className={`${styles.indicator} ${styles[status]}`}>
      <span className={styles.dot} />
      {labels[status]}
    </span>
  );
}

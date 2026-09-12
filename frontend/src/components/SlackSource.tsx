import SlackMark from './SlackMark';
import styles from './SlackSource.module.css';

export default function SlackSource({
  channel,
  tone = 'light',
  className = '',
}: {
  channel?: string;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const name = channel?.trim().replace(/^#/, '');
  return (
    <span className={`${styles.source} ${className}`} data-tone={tone} data-slack-source="true">
      <span className={styles.platform}>
        <SlackMark size={14} />
        <span>Slack</span>
      </span>
      {name && <span className={styles.channel}>#{name}</span>}
    </span>
  );
}

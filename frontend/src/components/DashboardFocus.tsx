import { channelName, senderName } from '../slackIdentity';
import { useState } from 'react';
import { ArrowUpRight, CalendarDays, ChevronDown, UserRound } from 'lucide-react';
import type { Message } from '../types';
import SlackSource from './SlackSource';
import StatusPill, { ClassificationPill, PriorityPill } from './StatusPill';
import styles from './DashboardFocus.module.css';

export function messagePreview(text: string, limit = 140) {
  const readable = text
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<@([^>]+)>/g, '@$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
  const first = readable.split(/\n|(?<=[.!?])\s+/)[0] || readable;
  if (first.length <= limit) return first;
  const words = first
    .slice(0, limit)
    .replace(/\s+\S*$/, '')
    .trimEnd();
  return `${words || first.slice(0, limit)}…`;
}

export default function DashboardFocus({
  message,
  onOpen,
}: {
  message: Message;
  onOpen: (id: string, trigger: HTMLButtonElement) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const task = message.action_extraction?.items?.find(
    (item) =>
      (item.owner || item.due) &&
      (!item.source_message_ids?.length || item.source_message_ids.includes(message.id)),
  );
  return (
    <article
      className={styles.card}
      data-testid="focus-message"
      data-message-id={message.id}
      aria-label="Priority Slack conversation"
    >
      <div className={styles.top}>
        <ClassificationPill classification={message.classification} surface="dark" />
        <PriorityPill priority={message.priority} surface="dark" />
      </div>
      <div className={styles.preview}>
        <h2>{messagePreview(message.text) || 'Conversation awaiting review'}</h2>
        <div className={styles.source}>
          <SlackSource channel={channelName(message)} tone="dark" />
          <StatusPill icon={UserRound} surface="dark">
            {senderName(message)}
          </StatusPill>
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.cta} onClick={(event) => onOpen(message.id, event.currentTarget)}>
          Review this <ArrowUpRight size={17} aria-hidden="true" />
        </button>
        <button
          className={styles.disclosure}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="priority-message-source"
        >
          {expanded ? 'Hide full message' : 'Read full message'}
          <ChevronDown size={14} className={expanded ? styles.rotated : ''} aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className={styles.fullMessage} id="priority-message-source">
          <p className={styles.originalLabel}>Original Slack message</p>
          <p className={styles.originalText} data-testid="focus-message-text">
            {message.text}
          </p>
          <dl className={styles.context}>
            {message.reason && (
              <div>
                <dt>Why it’s here</dt>
                <dd>{message.reason}</dd>
              </div>
            )}
            {message.suggested_action && (
              <div>
                <dt>Suggested next step</dt>
                <dd>{message.suggested_action}</dd>
              </div>
            )}
            {task?.owner && (
              <div>
                <dt>Owner</dt>
                <dd>
                  <StatusPill icon={UserRound} surface="dark">
                    {task.owner}
                  </StatusPill>
                </dd>
              </div>
            )}
            {task?.due && (
              <div>
                <dt>Due</dt>
                <dd>
                  <StatusPill icon={CalendarDays} surface="dark">
                    {task.due}
                  </StatusPill>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </article>
  );
}

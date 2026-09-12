import { channelName, senderName } from '../slackIdentity';
import { useState } from 'react';
import {
  ArrowUpRight,
  CheckCheck,
  ChevronDown,
  Coffee,
  GitBranch,
  ListFilter,
  MessageCircle,
  Search,
  ShieldAlert,
  TrendingUp,
  UserRound,
  Zap,
} from 'lucide-react';
import type { Classification, Message } from '../types';
import SlackSource from './SlackSource';
import StatusPill, { ClassificationPill, PriorityPill, ReviewPill } from './StatusPill';
import styles from './MessageGroups.module.css';

const signals = [
  { name: 'Incident', icon: ShieldAlert },
  { name: 'Escalation', icon: TrendingUp },
  { name: 'Approval Request', icon: CheckCheck },
  { name: 'Decision Needed', icon: GitBranch },
  { name: 'Action Required', icon: Zap },
  { name: 'Question', icon: MessageCircle },
  { name: 'FYI', icon: Coffee },
] satisfies { name: Classification; icon: typeof ShieldAlert }[];
const priorities = ['high', 'medium', 'low'] as const;
const priorityLabels = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };
const priorityRank = { high: 0, medium: 1, low: 2 };

// The queue presents a source excerpt. The adjacent reading affordance opens
// the original conversation in full, without adding another layer of controls.
function preview(text: string) {
  const clean = text
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<@([^>]+)>/g, '@$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  const firstSentence = clean.match(/^.*?[.!?](?=\s|$)/)?.[0] || clean;
  if (firstSentence.length <= 160) return firstSentence;
  const excerpt = firstSentence.slice(0, 157);
  const boundary = excerpt.lastIndexOf(' ');
  return `${excerpt.slice(0, boundary > 100 ? boundary : excerpt.length).trimEnd()}…`;
}

export default function MessageGroups({
  messages,
  category,
  priority,
  onChange,
  onOpen,
  compact = false,
}: {
  messages: Message[];
  category: string;
  priority: string;
  onChange: (category: string, priority: string) => void;
  onOpen: (id: string, trigger: HTMLButtonElement) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState<Partial<Record<Classification, boolean>>>({});
  const selectedCategory = signals.some((signal) => signal.name === category) ? category : 'all';
  const selectedPriority = priorities.some((value) => value === priority) ? priority : 'all';
  const byPriority = messages.filter(
    (message) => selectedPriority === 'all' || message.priority === selectedPriority,
  );
  const byCategory = messages.filter(
    (message) => selectedCategory === 'all' || message.classification === selectedCategory,
  );
  const matching = byPriority.filter(
    (message) => selectedCategory === 'all' || message.classification === selectedCategory,
  );
  const groups = signals
    .map((signal) => ({
      ...signal,
      messages: matching.filter((message) => message.classification === signal.name),
    }))
    .filter((group) => group.messages.length);
  // Classification and urgency are independent. Retain the active message sort
  // within each group and bring its most urgent remaining conversation forward.
  groups.sort(
    (a, b) =>
      Math.min(...a.messages.map((message) => priorityRank[message.priority])) -
      Math.min(...b.messages.map((message) => priorityRank[message.priority])),
  );
  const hasSelection = selectedCategory !== 'all' || selectedPriority !== 'all';

  return (
    <div className={styles.workspace} role="region" aria-label="Classified conversations">
      <aside className={styles.typeRail}>
        <span className={styles.typeHeading}>Message type</span>
        <div className={styles.types} role="group" aria-label="Message types">
          <button
            className={styles.type}
            aria-pressed={selectedCategory === 'all'}
            aria-label={`All types, ${byPriority.length} conversations`}
            onClick={() => onChange('all', selectedPriority)}
          >
            <ListFilter size={16} aria-hidden="true" />
            <span className={styles.typeName}>All types</span>
            <span className={styles.typeCount}>{byPriority.length}</span>
          </button>
          {signals.map(({ name, icon: Icon }) => {
            const count = byPriority.filter((message) => message.classification === name).length;
            return (
              <button
                key={name}
                className={styles.type}
                data-signal={name}
                data-empty={count === 0}
                aria-pressed={selectedCategory === name}
                aria-label={`${name}, ${count} conversations`}
                onClick={() => onChange(name, selectedPriority)}
              >
                <Icon size={16} aria-hidden="true" />
                <span className={styles.typeName}>{name}</span>
                <span className={styles.typeCount}>{count}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className={styles.queue}>
        <div className={styles.priorityBar}>
          <div className={styles.priorities} role="group" aria-label="Message priorities">
            <button
              aria-pressed={selectedPriority === 'all'}
              aria-label={`Any priority, ${byCategory.length} conversations`}
              onClick={() => onChange(selectedCategory, 'all')}
            >
              All priorities <span>{byCategory.length}</span>
            </button>
            {priorities.map((value) => {
              const count = byCategory.filter((message) => message.priority === value).length;
              return (
                <button
                  key={value}
                  data-priority={value}
                  aria-pressed={selectedPriority === value}
                  aria-label={`${priorityLabels[value]}, ${count} conversations`}
                  onClick={() => onChange(selectedCategory, value)}
                >
                  <i aria-hidden="true" />
                  {value[0].toUpperCase() + value.slice(1)} <span>{count}</span>
                </button>
              );
            })}
          </div>
          {hasSelection && (
            <button
              className={styles.reset}
              aria-label="Reset section filters"
              onClick={() => onChange('all', 'all')}
            >
              Reset
            </button>
          )}
        </div>
        <p className={styles.results} role="status">
          {matching.length} {matching.length === 1 ? 'conversation' : 'conversations'}
          {selectedCategory !== 'all'
            ? ` · ${selectedCategory}`
            : ` across ${groups.length} ${groups.length === 1 ? 'type' : 'types'}`}
          {selectedPriority !== 'all' &&
            ` · ${priorityLabels[selectedPriority as Message['priority']]}`}
        </p>

        <div className={styles.groups}>
          {groups.map(({ name, messages: groupMessages }) => {
            const limited = compact && !expanded[name] && groupMessages.length > 2;
            const visible = limited ? groupMessages.slice(0, 2) : groupMessages;
            return (
              <section
                className={styles.group}
                key={name}
                data-testid="classification-group"
                data-classification={name}
                aria-label={`${name} conversations`}
              >
                <header className={styles.groupHeading}>
                  <h3>
                    <ClassificationPill classification={name} />
                  </h3>
                  <span>{groupMessages.length}</span>
                </header>
                <div id={`group-${name.replaceAll(' ', '-').toLowerCase()}`}>
                  {visible.map((message) => (
                    <button
                      key={message.id}
                      className={styles.message}
                      data-testid="message-row"
                      data-message-id={message.id}
                      onClick={(event) => onOpen(message.id, event.currentTarget)}
                    >
                      <span className={styles.messageBody}>
                        <span className={styles.messageText} data-testid="conversation-preview">
                          {preview(message.text)}
                        </span>
                        <span className={styles.messageMeta}>
                          <SlackSource channel={channelName(message)} />
                          <StatusPill icon={UserRound} title={`From ${senderName(message)}`}>
                            {senderName(message)}
                          </StatusPill>
                          <ClassificationPill classification={message.classification} />
                          {message.decision && <ReviewPill decision={message.decision} />}
                        </span>
                      </span>
                      <span className={styles.messageAside}>
                        <PriorityPill priority={message.priority} />
                        <span className={styles.read}>
                          Read conversation <ArrowUpRight size={14} aria-hidden="true" />
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {compact && groupMessages.length > 2 && (
                  <button
                    className={styles.more}
                    aria-expanded={Boolean(expanded[name])}
                    aria-controls={`group-${name.replaceAll(' ', '-').toLowerCase()}`}
                    onClick={() =>
                      setExpanded((previous) => ({ ...previous, [name]: !previous[name] }))
                    }
                  >
                    {expanded[name]
                      ? `Show fewer in ${name}`
                      : `Show ${groupMessages.length - 2} more in ${name}`}
                    <ChevronDown
                      size={14}
                      className={expanded[name] ? styles.rotated : ''}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </section>
            );
          })}
        </div>
        {!matching.length && (
          <div className={styles.empty}>
            <Search size={23} aria-hidden="true" />
            <h3>
              {hasSelection ? 'No conversations in this combination' : 'Nothing else waiting here'}
            </h3>
            <p>
              {hasSelection
                ? 'Try another type or priority.'
                : 'New conversations will appear here as they arrive.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

import { channelName, channelOptions, senderName } from '../slackIdentity';
import SlackSource from '../components/SlackSource';
import StatusPill, { ClassificationPill, ReviewPill } from '../components/StatusPill';
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Coffee,
  Flame,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { classifications } from '../types';
import type { Message } from '../types';
import MessageDetail from '../components/MessageDetail';
import MessageGroups from '../components/MessageGroups';
import styles from './Inbox.module.css';
import DashboardFocus, { messagePreview } from '../components/DashboardFocus';
import dashboardStyles from './InboxDashboard.module.css';

function subject(message: Message) {
  const clean = message.text
    .replace(/<@[^>]+>\s*/g, '')
    .replace(/^\s*(?:FYI:\s*)/i, '')
    .trim();
  const first = clean.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() || clean;
  return first.length > 105 ? `${first.slice(0, 102).trimEnd()}…` : first;
}
function assignment(message: Message) {
  return message.action_extraction?.items?.find(
    (item) =>
      (item.owner || item.due) &&
      (!item.source_message_ids?.length || item.source_message_ids.includes(message.id)),
  );
}
function iconFor(message: Message) {
  return message.classification === 'Incident' || message.classification === 'Escalation'
    ? ShieldAlert
    : message.classification === 'Decision Needed'
      ? Sparkles
      : message.classification === 'Approval Request'
        ? CheckCheck
        : message.classification === 'FYI'
          ? Coffee
          : message.classification === 'Question'
            ? MessageCircle
            : Zap;
}
function order(a: Message, b: Message) {
  return (
    Number(a.classification === 'FYI') - Number(b.classification === 'FYI') ||
    { high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority] ||
    b.score - a.score ||
    Date.parse(b.created_at) - Date.parse(a.created_at)
  );
}

export default function Inbox({
  messages,
  loading,
  failed,
  fetching,
  reviewed = false,
  notify,
}: {
  messages: Message[];
  loading: boolean;
  failed: boolean;
  fetching: boolean;
  reviewed?: boolean;
  notify: (message: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const query = params.get('q') || '',
    category = params.get('category') || 'all',
    priority = params.get('priority') || 'all',
    channel = params.get('channel') || 'all',
    sort = params.get('sort') || 'priority',
    date = params.get('date') || 'all',
    view = params.get('view') || 'pending',
    outcome = params.get('outcome') || 'all';
  const hasFilters = Boolean(
    query ||
    category !== 'all' ||
    priority !== 'all' ||
    channel !== 'all' ||
    date !== 'all' ||
    outcome !== 'all' ||
    sort !== 'priority',
  );
  const [toolsOpen, setToolsOpen] = useState(hasFilters);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedId = params.get('message');
  const selected = messages.find((m) => m.id === selectedId);
  const set = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (
          !value ||
          (value === 'all' && ['category', 'priority', 'channel', 'date', 'outcome'].includes(key))
        )
          next.delete(key);
        else next.set(key, value);
        if (key !== 'message') next.delete('message');
        return next;
      },
      { replace: true },
    );
  const open = (id: string, trigger?: HTMLButtonElement) => {
    if (trigger) triggerRef.current = trigger;
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('message', id);
      return next;
    });
  };
  const close = () => set('message', '');
  const pending = messages.filter((m) => !m.decision).sort(order);
  const attention = pending.filter((m) => m.classification !== 'FYI');
  const priorityCounts = {
    high: pending.filter((message) => message.priority === 'high').length,
    medium: pending.filter((message) => message.priority === 'medium').length,
    low: pending.filter((message) => message.priority === 'low').length,
  };
  const deferred = messages.filter((m) => m.decision === 'deferred');
  const done = messages.filter((m) => m.decision && m.decision !== 'deferred');
  const base = messages.filter((m) =>
    reviewed
      ? !!m.decision && m.decision !== 'deferred'
      : view === 'all'
        ? true
        : view === 'deferred'
          ? m.decision === 'deferred'
          : !m.decision,
  );
  const channels = channelOptions(messages);
  const filtered = useMemo(
    () =>
      base
        .filter(
          (m) =>
            (category === 'all' || m.classification === category) &&
            (priority === 'all' || m.priority === priority) &&
            (channel === 'all' || m.channel === channel) &&
            (outcome === 'all' || m.decision === outcome) &&
            (date === 'all' ||
              Date.now() - Date.parse(m.created_at) < (date === 'day' ? 1 : 7) * 86400000) &&
            [m.text, m.sender, senderName(m), m.channel, channelName(m), m.reason]
              .join(' ')
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === 'newest'
            ? Date.parse(b.created_at) - Date.parse(a.created_at)
            : sort === 'oldest'
              ? Date.parse(a.created_at) - Date.parse(b.created_at)
              : reviewed
                ? Date.parse(b.decided_at || b.created_at) -
                  Date.parse(a.decided_at || a.created_at)
                : order(a, b),
        ),
    [base, category, priority, channel, outcome, date, query, sort, reviewed],
  );
  const focused = !reviewed && view === 'pending' && !hasFilters;
  const focus = focused ? attention[0] : undefined;
  const nextUp = focused ? attention.slice(1, 3) : [];
  const featuredIds = new Set([focus?.id, ...nextUp.map((m) => m.id)]);
  const rows = focused ? filtered.filter((m) => !featuredIds.has(m.id)) : filtered;
  const filterSection = (signal: string, urgency: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of [
          ['signal', signal],
          ['urgency', urgency],
        ]) {
          if (value === 'all') next.delete(key);
          else next.set(key, value);
        }
        next.delete('message');
        return next;
      },
      { replace: true },
    );
  const nextPending = pending.filter((m) => m.id !== selectedId);
  const clear = () =>
    setParams((previous) => {
      const next = new URLSearchParams();
      if (previous.get('view')) next.set('view', previous.get('view')!);
      return next;
    });

  const renderRow = (message: Message) => {
    const Icon = iconFor(message);
    const item = assignment(message);
    return (
      <button
        key={message.id}
        data-testid="message-row"
        data-message-id={message.id}
        className={`${styles.conversationRow} ${message.decision ? styles.resolvedRow : ''}`}
        onClick={(event) => open(message.id, event.currentTarget)}
      >
        <span className={`${styles.rowIcon} ${styles[message.priority]}`}>
          <Icon size={19} />
        </span>
        <span className={styles.rowContent}>
          <strong>{subject(message)}</strong>
          <span>
            <SlackSource channel={channelName(message)} />
            <StatusPill icon={UserRound}>{item?.owner || senderName(message)}</StatusPill>
          </span>
        </span>
        <span className={styles.rowStatus}>
          {message.decision ? (
            <ReviewPill decision={message.decision} />
          ) : item?.due ? (
            <StatusPill icon={Clock3} tone="info" className={styles.rowDue}>
              {item.due}
            </StatusPill>
          ) : (
            <ClassificationPill classification={message.classification} />
          )}
          <ChevronRight size={17} />
        </span>
      </button>
    );
  };

  return (
    <div className={`${styles.page} ${!reviewed ? dashboardStyles.page : ''}`}>
      <header className={reviewed ? styles.pageHeading : dashboardStyles.heading}>
        <div>
          {reviewed && <p className="eyebrow">YOUR SLACK REVIEW HISTORY</p>}
          <h1>{reviewed ? 'A little lighter.' : 'Inbox overview'}</h1>
          <p>
            {reviewed
              ? `${done.length} Slack conversations reviewed. Every call, kept here.`
              : 'Your Slack conversations, prioritized.'}
          </p>
        </div>
        <div className={dashboardStyles.headingRight}>
          {!reviewed && (
            <time dateTime={new Date().toLocaleDateString('en-CA')}>
              {new Date().toLocaleDateString([], {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </time>
          )}
          <button
            className={dashboardStyles.refresh}
            onClick={() => void client.invalidateQueries({ queryKey: ['messages'] })}
            disabled={fetching}
            aria-label="Refresh queue"
          >
            <RefreshCw size={14} className={fetching ? 'spinning' : ''} />
            <span>{fetching ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </header>
      {!reviewed && (
        <dl className={dashboardStyles.metrics} aria-label="Inbox totals" aria-busy={loading}>
          <div className={dashboardStyles.metric} data-state="pending">
            <dt>
              <span className={dashboardStyles.metricIcon}>
                <MessageCircle size={14} aria-hidden="true" />
              </span>
              Needs review
            </dt>
            <dd>
              {loading ? '—' : pending.length}
              <span>conversations</span>
            </dd>
          </div>
          <div className={dashboardStyles.metric} data-priority="high">
            <dt>
              <span className={dashboardStyles.metricIcon}>
                <Flame size={14} aria-hidden="true" />
              </span>
              High priority
            </dt>
            <dd>
              {loading ? '—' : priorityCounts.high}
              <span>pending</span>
            </dd>
          </div>
          <div className={dashboardStyles.metric} data-state="deferred">
            <dt>
              <span className={dashboardStyles.metricIcon}>
                <Clock3 size={14} aria-hidden="true" />
              </span>
              Deferred
            </dt>
            <dd>
              {loading ? '—' : deferred.length}
              <span>saved for later</span>
            </dd>
          </div>
          <div className={dashboardStyles.metric} data-state="reviewed">
            <dt>
              <span className={dashboardStyles.metricIcon}>
                <CheckCheck size={14} aria-hidden="true" />
              </span>
              Reviewed
            </dt>
            <dd>
              {loading ? '—' : done.length}
              <span>completed reviews</span>
            </dd>
          </div>
        </dl>
      )}
      {loading ? (
        <div className={styles.loadingFocus} aria-label="Loading your focus" role="status">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : focus ? (
        <section className={dashboardStyles.focusGrid} aria-label="Your next conversations">
          <DashboardFocus key={focus.id} message={focus} onOpen={open} />
          <aside className={dashboardStyles.insights} aria-label="Queue overview">
            <div className={dashboardStyles.insightHeading}>
              <h2>Priority balance</h2>
              <StatusPill icon={Clock3}>{pending.length} pending</StatusPill>
            </div>
            <div
              className={dashboardStyles.balance}
              role="img"
              aria-label={`Pending priorities: ${priorityCounts.high} high, ${priorityCounts.medium} medium, ${priorityCounts.low} low`}
            >
              {(['high', 'medium', 'low'] as const).map(
                (level) =>
                  priorityCounts[level] > 0 && (
                    <span
                      key={level}
                      data-priority={level}
                      style={{ flex: priorityCounts[level] }}
                    />
                  ),
              )}
            </div>
            <div className={dashboardStyles.legend}>
              <span>
                <strong>{priorityCounts.high}</strong>High
              </span>
              <span>
                <strong>{priorityCounts.medium}</strong>Medium
              </span>
              <span>
                <strong>{priorityCounts.low}</strong>Low
              </span>
            </div>
            <div className={dashboardStyles.nextHeading}>
              <h3>Up next</h3>
              <StatusPill>{nextUp.length} conversations</StatusPill>
            </div>
            {nextUp.map((message) => {
              return (
                <button
                  key={message.id}
                  className={dashboardStyles.nextCard}
                  data-testid="message-row"
                  data-message-id={message.id}
                  onClick={(event) => open(message.id, event.currentTarget)}
                >
                  <span className={dashboardStyles.nextText}>
                    <strong>{messagePreview(message.text, 74)}</strong>
                    <small>
                      <ClassificationPill classification={message.classification} />
                    </small>
                  </span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              );
            })}
            {!nextUp.length && (
              <p className={dashboardStyles.noNext}>Your next priority will appear here.</p>
            )}
          </aside>
        </section>
      ) : focused && !failed ? (
        <div className={styles.allClear}>
          <div className={styles.clearOrb}>
            <Check size={34} />
          </div>
          <div>
            <p className="eyebrow">A MOMENT TO BREATHE</p>
            <h2>You’ve made room.</h2>
            <p>
              {pending.length
                ? 'Your remaining messages are grouped by type below.'
                : 'No conversations waiting for review.'}
            </p>
          </div>
        </div>
      ) : null}
      {reviewed && (
        <div className={styles.reviewSummary}>
          <span className={styles.reviewCheck}>
            <CheckCheck size={25} />
          </span>
          <div className={styles.reviewTrack} aria-hidden="true">
            {Array.from({ length: Math.min(done.length, 25) }, (_, i) => (
              <span key={i} />
            ))}
          </div>
          <span>
            <strong>{done.length}</strong> reviewed
          </span>
          <span className={styles.reviewSummaryNote}>Progress, one conversation at a time.</span>
        </div>
      )}
      <section
        className={reviewed ? styles.collection : dashboardStyles.collection}
        aria-label="Message queue"
      >
        <div className={reviewed ? styles.collectionHeading : dashboardStyles.collectionHeading}>
          <div>
            <h2>
              {reviewed
                ? 'Your recent calls.'
                : view === 'deferred'
                  ? 'Deferred conversations'
                  : 'Conversations'}
            </h2>
          </div>
          <button
            className={`${styles.toolsButton} ${toolsOpen ? styles.toolsActive : ''}`}
            onClick={() => setToolsOpen(!toolsOpen)}
            aria-label="Search & filter"
            aria-expanded={toolsOpen}
            aria-controls="inbox-filters"
          >
            <Search size={16} />
            <span>Search & filter</span>
            {hasFilters && <i />}
          </button>
        </div>
        <div className={reviewed ? styles.queueNavigation : dashboardStyles.queueNavigation}>
          <div className={styles.viewTabs} role="group" aria-label="Queue view">
            {reviewed ? (
              <span className={styles.reviewedLabel}>
                <CheckCheck size={15} />
                Reviewed
              </span>
            ) : (
              [
                ['pending', 'Needs review', pending.length],
                ['deferred', 'Deferred', deferred.length],
                ['all', 'All messages', messages.length],
              ].map(([key, label, count]) => (
                <button
                  key={key}
                  aria-pressed={view === key}
                  className={view === key ? styles.activeTab : ''}
                  onClick={() => set('view', String(key))}
                >
                  {label}
                  <span>{count}</span>
                </button>
              ))
            )}
          </div>
          <span className={styles.listCount}>
            {rows.length} {focused ? 'remaining' : 'conversations'}
          </span>
        </div>
        {(toolsOpen || hasFilters) && (
          <div id="inbox-filters" className={styles.filters}>
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Inbox search"
                placeholder="Find a conversation…"
                value={query}
                onChange={(event) => set('q', event.target.value)}
              />
              {query && (
                <button aria-label="Clear search" onClick={() => set('q', '')}>
                  <X size={15} />
                </button>
              )}
            </label>
            <select
              aria-label="Category"
              value={category}
              onChange={(event) => set('category', event.target.value)}
            >
              <option value="all">All categories</option>
              {classifications.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Priority"
              value={priority}
              onChange={(event) => set('priority', event.target.value)}
            >
              <option value="all">Any priority</option>
              <option value="high">High priority</option>
              <option value="medium">Medium priority</option>
              <option value="low">Low priority</option>
            </select>
            <select
              aria-label="Channel"
              value={channel}
              onChange={(event) => set('channel', event.target.value)}
            >
              <option value="all">All channels</option>
              {channels.map((c) => (
                <option key={c.value} value={c.value}>
                  #{c.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Message date"
              value={date}
              onChange={(event) => set('date', event.target.value)}
            >
              <option value="all">Any time</option>
              <option value="day">Last 24 hours</option>
              <option value="week">Last 7 days</option>
            </select>
            <select
              aria-label="Sort messages"
              value={sort}
              onChange={(event) => set('sort', event.target.value)}
            >
              <option value="priority">{reviewed ? 'Latest review' : 'Priority first'}</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            {reviewed && (
              <select
                aria-label="Review outcome"
                value={outcome}
                onChange={(event) => set('outcome', event.target.value)}
              >
                <option value="all">All outcomes</option>
                <option value="approved">Approved</option>
                <option value="dismissed">Dismissed</option>
                <option value="escalated">Escalated</option>
              </select>
            )}
            {hasFilters && (
              <button className="btn ghost" onClick={clear}>
                Clear filters
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {!reviewed && !loading && (rows.length > 0 || (!failed && focused && !hasFilters)) ? (
          <MessageGroups
            key={view}
            messages={rows}
            category={params.get('signal') || 'all'}
            priority={params.get('urgency') || 'all'}
            onChange={filterSection}
            onOpen={open}
            compact={focused}
          />
        ) : (
          <div className={styles.conversations}>
            {loading
              ? Array.from({ length: 3 }, (_, i) => (
                  <div className={styles.loadingRow} key={i}>
                    <div className="skeleton" />
                  </div>
                ))
              : rows.length
                ? rows.map(renderRow)
                : !focus && (
                    <div className="empty-state">
                      <span className="empty-icon">
                        {hasFilters ? (
                          <Search size={25} />
                        ) : failed ? (
                          <MessageCircle size={25} />
                        ) : (
                          <CheckCheck size={25} />
                        )}
                      </span>
                      <h3>
                        {hasFilters
                          ? 'No matching conversations'
                          : failed
                            ? 'Messages are unavailable'
                            : view === 'deferred'
                              ? 'Nothing on hold'
                              : reviewed
                                ? 'Your next review starts the story'
                                : 'All clear here.'}
                      </h3>
                      <p>
                        {hasFilters
                          ? 'Try another word or clear your filters.'
                          : failed
                            ? 'Use Retry above to reconnect.'
                            : view === 'deferred'
                              ? 'Conversations you defer will stay here.'
                              : reviewed
                                ? 'Your saved reviews will appear here.'
                                : 'There’s nothing else waiting in this view.'}
                      </p>
                      {hasFilters && (
                        <button className="btn" onClick={clear}>
                          Clear filters
                        </button>
                      )}
                    </div>
                  )}
          </div>
        )}
        {view === 'deferred' && (
          <p className={styles.collectionNote}>
            <Clock3 size={13} />
            Saved for later. No reminder is scheduled.
          </p>
        )}
      </section>
      {reviewed && (
        <div className={styles.focusNote}>
          <span>
            <Sparkles size={13} />
            {reviewed
              ? 'Your latest reviews, kept together.'
              : 'Ranked by urgency and actionability.'}
          </span>
          <span>
            {messages.length} conversations in this workspace
            <ArrowDown size={12} />
          </span>
        </div>
      )}
      <Dialog.Root
        open={Boolean(selectedId)}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.reviewOverlay} />
          <Dialog.Content
            className={styles.reviewDialog}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              requestAnimationFrame(() => {
                if (triggerRef.current?.isConnected)
                  triggerRef.current.focus({ preventScroll: true });
                else document.getElementById('main-content')?.focus({ preventScroll: true });
              });
            }}
          >
            <Dialog.Title className="sr-only">Review conversation</Dialog.Title>
            <Dialog.Description className="sr-only">
              Understand the signal, prepare a response, and make your review decision.
            </Dialog.Description>
            {selected ? (
              <MessageDetail
                key={selected.id}
                message={selected}
                onClose={close}
                notify={notify}
                nextCount={nextPending.length}
                onNext={nextPending.length ? () => open(nextPending[0].id) : undefined}
              />
            ) : (
              <div className="empty-state">
                <MessageCircle size={30} />
                <h2>{loading ? 'Loading conversation…' : 'This conversation is unavailable.'}</h2>
                <button className="btn" onClick={close}>
                  Back to inbox
                </button>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

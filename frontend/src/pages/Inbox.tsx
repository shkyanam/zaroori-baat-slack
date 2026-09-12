import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coffee,
  Flame,
  ListFilter,
  MessageCircle,
  Moon,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { classifications } from '../types';
import type { Message } from '../types';
import MessageDetail from '../components/MessageDetail';
import styles from './Inbox.module.css';

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
function initials(name: string) {
  return (
    name
      .replace(/[^a-zA-Z\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || 'SL'
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
  const [quietOpen, setQuietOpen] = useState(false);
  const [showAllRemaining, setShowAllRemaining] = useState(false);
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
  const high = attention.filter((m) => m.priority === 'high');
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
  const channels = [...new Set(messages.map((m) => m.channel))].sort();
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
            [m.text, m.sender, m.channel, m.reason]
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
  const rows = focused
    ? filtered.filter((m) => !featuredIds.has(m.id) && m.classification !== 'FYI')
    : filtered;
  const quiet = focused ? filtered.filter((m) => m.classification === 'FYI') : [];
  const nextPending = pending.filter((m) => m.id !== selectedId);
  const clear = () =>
    setParams((previous) => {
      const next = new URLSearchParams();
      if (previous.get('view')) next.set('view', previous.get('view')!);
      return next;
    });
  const FocusIcon = focus ? iconFor(focus) : Sparkles;
  const focusAssignment = focus ? assignment(focus) : undefined;

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
            #{message.channel.replace(/^#/, '')}
            <i>·</i>
            {item?.owner || message.sender}
          </span>
        </span>
        <span className={styles.rowStatus}>
          {message.decision ? (
            <span className="badge">
              {message.decision === 'approved'
                ? 'Approved'
                : message.decision === 'dismissed'
                  ? 'Dismissed'
                  : message.decision === 'deferred'
                    ? 'Deferred'
                    : 'Escalated'}
            </span>
          ) : item?.due ? (
            <span className={styles.rowDue}>
              <Clock3 size={12} />
              {item.due}
            </span>
          ) : (
            <span className={styles.rowCategory}>{message.classification}</span>
          )}
          <ChevronRight size={17} />
        </span>
      </button>
    );
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeading}>
        <div>
          <p className="eyebrow">
            {reviewed
              ? 'ROOM TO MOVE FORWARD'
              : new Date()
                  .toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
                  .toUpperCase()}
          </p>
          <h1>
            {reviewed ? (
              'A little lighter.'
            ) : (
              <>
                Less noise.<span> More headspace.</span>
              </>
            )}
          </h1>
          <p>
            {reviewed ? (
              `${done.length} conversations reviewed. Every call, kept here.`
            ) : (
              <>
                Hi Mitesh.{' '}
                {high.length ? (
                  <>
                    You have <strong>{high.length} important conversations</strong>. Let’s take them
                    one at a time.
                  </>
                ) : (
                  'Your next clear step is right here.'
                )}
              </>
            )}
          </p>
        </div>
        <button
          className={styles.refresh}
          onClick={() => void client.invalidateQueries({ queryKey: ['messages'] })}
          disabled={fetching}
          aria-label="Refresh queue"
        >
          <RefreshCw size={16} className={fetching ? 'spinning' : ''} />
          <span>{fetching ? 'Refreshing' : 'Refresh'}</span>
        </button>
      </header>
      {loading ? (
        <div className={styles.loadingFocus} aria-label="Loading your focus" role="status">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : focus ? (
        <section className={styles.focusGrid} aria-label="Your next conversations">
          <article
            data-testid="focus-message"
            data-message-id={focus.id}
            className={styles.focusCard}
          >
            <div className={styles.focusTop}>
              <span>
                <span className={styles.pulseDot} />
                START HERE
              </span>
              <span className={styles.focusPriority}>
                {focus.priority === 'high' ? <Flame size={13} /> : <Sparkles size={13} />}{' '}
                {focus.priority === 'high' ? 'Worth your attention' : 'Your next conversation'}
              </span>
            </div>
            <div className={styles.focusContent}>
              <div className={styles.focusWriting}>
                <span className={styles.focusCategory}>{focus.classification}</span>
                <h2>{subject(focus)}</h2>
                <div className={styles.focusPeople}>
                  <span className={styles.focusAvatar}>
                    {initials(focusAssignment?.owner || focus.sender)}
                  </span>
                  <span>
                    {focusAssignment?.owner || focus.sender}
                    <small>#{focus.channel.replace(/^#/, '')}</small>
                  </span>
                  {focusAssignment?.due && (
                    <span className={styles.focusDue}>
                      <Clock3 size={13} />
                      {focusAssignment.due}
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.focusVisual} aria-hidden="true">
                <div className={styles.orbitOne} />
                <div className={styles.orbitTwo} />
                <div className={styles.orbitThree} />
                <div className={styles.orb}>
                  <FocusIcon size={38} strokeWidth={1.2} />
                </div>
                <span className={styles.orbitDot} />
                <span className={styles.floatingMark}>
                  <Sparkles size={16} />
                </span>
                <span className={styles.orbitLabel}>FIND YOUR FOCUS</span>
              </div>
            </div>
            <div className={styles.focusBottom}>
              <button
                className={styles.focusCTA}
                onClick={(event) => open(focus.id, event.currentTarget)}
              >
                Review this
                <ArrowUpRight size={19} />
              </button>
              <span>
                <Sparkles size={13} />
                Context already gathered
              </span>
            </div>
          </article>
          <aside className={styles.upNext}>
            <div className={styles.upNextHeading}>
              <h2>Then, these.</h2>
              <span>{nextUp.length} up next</span>
            </div>
            {nextUp.map((message, index) => {
              const Icon = iconFor(message);
              return (
                <button
                  key={message.id}
                  data-testid="message-row"
                  data-message-id={message.id}
                  className={`${styles.nextCard} ${index === 1 ? styles.nextLavender : ''}`}
                  onClick={(event) => open(message.id, event.currentTarget)}
                >
                  <span className={styles.nextTop}>
                    <span className={styles.nextIcon}>
                      <Icon size={18} />
                    </span>
                    <span>{message.classification}</span>
                    <span className={styles.nextNumber}>0{index + 2}</span>
                  </span>
                  <strong>{subject(message)}</strong>
                  <span className={styles.nextBottom}>
                    <span>#{message.channel.replace(/^#/, '')}</span>
                    <ArrowUpRight size={17} />
                  </span>
                </button>
              );
            })}
            {!nextUp.length && (
              <div className={styles.breathingRoom}>
                <Coffee size={30} />
                <strong>One thing is enough.</strong>
                <p>Take this conversation at your pace.</p>
              </div>
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
                ? 'Only informational messages remain below.'
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
      <section className={styles.collection} aria-label="Message queue">
        <div className={styles.collectionHeading}>
          <div>
            <h2>
              {reviewed
                ? 'Your recent calls.'
                : focused
                  ? 'Everything else.'
                  : view === 'deferred'
                    ? 'Ready when you are.'
                    : 'Your conversations.'}
            </h2>
            {focused && <p>The important things come first. The rest stays within reach.</p>}
          </div>
          <button
            className={`${styles.toolsButton} ${toolsOpen ? styles.toolsActive : ''}`}
            onClick={() => setToolsOpen(!toolsOpen)}
            aria-expanded={toolsOpen}
            aria-controls="inbox-filters"
          >
            <Search size={16} />
            <span>Search & filter</span>
            {hasFilters && <i />}
            <ListFilter size={15} />
          </button>
        </div>
        <div className={styles.queueNavigation}>
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
          <span className={styles.listCount}>{filtered.length} conversations</span>
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
                <option key={c}>{c}</option>
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
        <div className={styles.conversations}>
          {loading
            ? Array.from({ length: 3 }, (_, i) => (
                <div className={styles.loadingRow} key={i}>
                  <div className="skeleton" />
                </div>
              ))
            : rows.length
              ? (focused && !showAllRemaining ? rows.slice(0, 4) : rows).map(renderRow)
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
        {focused && rows.length > 4 && (
          <button
            className={styles.showMore}
            onClick={() => setShowAllRemaining(!showAllRemaining)}
            aria-expanded={showAllRemaining}
          >
            {showAllRemaining ? 'Keep it focused' : `Show ${rows.length - 4} more conversations`}
            <ChevronDown size={15} className={showAllRemaining ? styles.rotated : ''} />
          </button>
        )}
        {!!quiet.length && (
          <div className={styles.quietCorner}>
            <button
              className={styles.quietToggle}
              onClick={() => setQuietOpen(!quietOpen)}
              aria-expanded={quietOpen}
            >
              <span className={styles.quietIcon}>
                <Moon size={18} />
              </span>
              <span>
                <strong>Quiet corner</strong>
                <small>
                  {quiet.length} FYI {quiet.length === 1 ? 'message' : 'messages'}. Here if you need
                  them.
                </small>
              </span>
              <ChevronDown size={18} className={quietOpen ? styles.rotated : ''} />
            </button>
            {quietOpen && quiet.map(renderRow)}
          </div>
        )}
        {view === 'deferred' && (
          <p className={styles.collectionNote}>
            <Clock3 size={13} />
            Saved for later. No reminder is scheduled.
          </p>
        )}
      </section>
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

import { channelName, senderName } from '../slackIdentity';
import SlackSource from '../components/SlackSource';
import StatusPill, { WorkTypePill } from '../components/StatusPill';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  CornerDownRight,
  ListTodo,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import type { Message } from '../types';
import styles from './Pages.module.css';

type ItemKind = 'task' | 'follow-up' | 'risk' | 'other';
const kindLabels: Record<ItemKind, string> = {
  task: 'Tasks',
  'follow-up': 'Follow-ups',
  risk: 'Risks',
  other: 'Other',
};
const laneCopy: Record<ItemKind, string> = {
  task: 'Make it happen',
  'follow-up': 'Keep it moving',
  risk: 'Keep an eye on it',
  other: 'Worth a look',
};
function kindOf(type: string): ItemKind {
  const value = type.toLowerCase().replace(/[ _-]/g, '');
  if (value.includes('risk')) return 'risk';
  if (value.includes('follow')) return 'follow-up';
  if (value.includes('task') || value === 'action') return 'task';
  return 'other';
}
function meaningfulOwner(owner?: string | null): string {
  if (!owner || /^(unknown|none|unassigned|not specified|tbd|n\/a)$/i.test(owner.trim())) return '';
  return owner.trim();
}
export default function ActionItems({
  messages,
  loading = false,
  failed = false,
}: {
  messages: Message[];
  loading?: boolean;
  failed?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<ItemKind | 'all'>('all');
  const [owner, setOwner] = useState('all');
  const [showTools, setShowTools] = useState(false);
  const [expandedLanes, setExpandedLanes] = useState<ItemKind[]>([]);
  const records = useMemo(() => {
    const byId = new Map(messages.map((message) => [message.id, message]));
    const candidates = messages.flatMap((message) =>
      (message.action_extraction?.items || [])
        .filter((item) => !item.type.toLowerCase().includes('decision'))
        .map((item) => {
          const sourceIds = [
            ...new Set(
              item.source_message_ids?.filter(Boolean).length
                ? item.source_message_ids.filter(Boolean)
                : [message.id],
            ),
          ].sort();
          const ownSource = sourceIds.includes(message.id);
          const source = ownSource
            ? message
            : sourceIds
                .map((id) => byId.get(id))
                .find((value): value is Message => Boolean(value)) || message;
          const kind = kindOf(item.type);
          const key = JSON.stringify([
            kind,
            item.title.toLowerCase().replace(/\s+/g, ' ').trim(),
            sourceIds,
          ]);
          return {
            ...item,
            key,
            message: source,
            ownSource,
            kind,
            owner: meaningfulOwner(item.owner),
          };
        }),
    );
    const unique = new Map<string, (typeof candidates)[number]>();
    for (const record of candidates) {
      const previous = unique.get(record.key);
      if (!previous || (record.ownSource && !previous.ownSource)) unique.set(record.key, record);
    }
    return [...unique.values()];
  }, [messages]);
  const owners = useMemo(
    () => [...new Set(records.map((item) => item.owner).filter(Boolean))].sort(),
    [records],
  );
  const visible = records.filter(
    (item) =>
      (kind === 'all' || item.kind === kind) &&
      (owner === 'all' || (owner === 'unassigned' ? !item.owner : item.owner === owner)) &&
      `${item.title} ${item.owner} ${item.message.channel} ${channelName(item.message)} ${item.message.sender} ${senderName(item.message)}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const counts = { task: 0, 'follow-up': 0, risk: 0, other: 0 };
  for (const item of records) counts[item.kind] += 1;
  const hasFilters = Boolean(search || kind !== 'all' || owner !== 'all');
  const lanes = (Object.keys(kindLabels) as ItemKind[]).filter(
    (value) => (value !== 'other' || counts.other > 0) && (kind === 'all' || kind === value),
  );
  function clearFilters() {
    setSearch('');
    setKind('all');
    setOwner('all');
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageIntro}>
        <div>
          <p className="eyebrow">FROM YOUR SLACK CONVERSATIONS</p>
          <h1>
            Action items
            <span className={styles.headingDot} aria-hidden="true">
              .
            </span>
          </h1>
          <p className={styles.introCopy}>Your team's next moves, already gathered.</p>
        </div>
        <div className={styles.heroToken} aria-label={`${records.length} extracted items`}>
          <Sparkles size={20} aria-hidden="true" />
          <strong>{!messages.length && (loading || failed) ? '—' : records.length}</strong>
          <span>next moves</span>
        </div>
      </header>

      {!messages.length && (loading || failed) ? (
        loading ? (
          <div className={styles.lanes} role="status" aria-label="Loading action items">
            {[0, 1, 2].map((value) => (
              <div className={styles.loadingCard} key={value}>
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <CircleAlert size={32} aria-hidden="true" />
            <h2>Action items are unavailable</h2>
            <p>Use Retry above to load your messages.</p>
          </div>
        )
      ) : (
        <section aria-label="Extracted action items">
          <div className={styles.collectionToolbar}>
            <div className={styles.tabs} role="group" aria-label="Action item type">
              <button
                className={kind === 'all' ? styles.activeTab : ''}
                onClick={() => setKind('all')}
                aria-pressed={kind === 'all'}
              >
                All items <span>{records.length}</span>
              </button>
              {(Object.keys(kindLabels) as ItemKind[])
                .filter((value) => value !== 'other' || counts.other > 0)
                .map((value) => (
                  <button
                    key={value}
                    className={kind === value ? styles.activeTab : ''}
                    onClick={() => setKind(value)}
                    aria-pressed={kind === value}
                  >
                    {kindLabels[value]} <span>{counts[value]}</span>
                  </button>
                ))}
            </div>
            <button
              className={`btn ghost ${styles.toolButton}`}
              onClick={() => setShowTools(!showTools)}
              aria-expanded={showTools}
              aria-controls="action-tools"
            >
              <SlidersHorizontal size={17} aria-hidden="true" />
              Search & filter{(search || owner !== 'all') && <span className={styles.filterDot} />}
            </button>
          </div>
          {showTools && (
            <div className={styles.filterBar} id="action-tools">
              <label className={`search-field ${styles.search}`}>
                <Search size={17} aria-hidden="true" />
                <span className="sr-only">Search action items</span>
                <input
                  type="search"
                  placeholder="Find a next move…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label className={styles.selectLabel}>
                <span className="sr-only">Filter by owner</span>
                <select
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  aria-label="Filter by owner"
                >
                  <option value="all">Everyone</option>
                  <option value="unassigned">Owner not identified</option>
                  {owners.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              {hasFilters && (
                <button className="btn ghost" onClick={clearFilters}>
                  <X size={15} aria-hidden="true" />
                  Clear filters
                </button>
              )}
            </div>
          )}

          {visible.length ? (
            <div className={`${styles.lanes} ${kind !== 'all' ? styles.singleLane : ''}`}>
              {lanes.map((lane) => (
                <section
                  key={lane}
                  className={`${styles.lane} ${lane === 'follow-up' ? styles.followLane : lane === 'risk' ? styles.riskLane : ''}`}
                  aria-label={kindLabels[lane]}
                >
                  <header className={styles.laneHeader}>
                    <div className={styles.laneIcon}>
                      {lane === 'risk' ? (
                        <CircleAlert size={23} aria-hidden="true" />
                      ) : lane === 'follow-up' ? (
                        <CornerDownRight size={23} aria-hidden="true" />
                      ) : (
                        <ListTodo size={23} aria-hidden="true" />
                      )}
                    </div>
                    <div>
                      <h2>{laneCopy[lane]}</h2>
                      <StatusPill
                        tone={lane === 'risk' ? 'danger' : lane === 'follow-up' ? 'memory' : 'info'}
                      >
                        {kindLabels[lane]} · {visible.filter((item) => item.kind === lane).length}
                      </StatusPill>
                    </div>
                  </header>
                  <div className={styles.laneCards} id={`action-lane-${lane}`}>
                    {visible
                      .filter((item) => item.kind === lane)
                      .slice(0, hasFilters || expandedLanes.includes(lane) ? undefined : 3)
                      .map((item) => (
                        <article
                          className={styles.actionCard}
                          key={item.key}
                          data-message-id={item.message.id}
                        >
                          <SlackSource channel={channelName(item.message)} />
                          <h3 title={item.title}>{item.title}</h3>
                          <div className={styles.actionMeta}>
                            <StatusPill
                              icon={UserRound}
                              title={item.owner ? 'Identified owner' : undefined}
                            >
                              {item.owner || 'Owner not identified'}
                            </StatusPill>
                            {item.due && (
                              <StatusPill
                                icon={CalendarDays}
                                tone="info"
                                title="Due date from the conversation"
                              >
                                {item.due}
                              </StatusPill>
                            )}
                          </div>
                          <footer className={styles.actionFooter}>
                            <WorkTypePill type={item.type} />
                            <Link
                              className={styles.sourceLink}
                              to={`/inbox?message=${encodeURIComponent(item.message.id)}`}
                            >
                              View source <ArrowUpRight size={16} aria-hidden="true" />
                            </Link>
                          </footer>
                        </article>
                      ))}
                    {!visible.some((item) => item.kind === lane) && (
                      <div className={styles.emptyLane}>
                        <Check size={23} aria-hidden="true" />
                        <p>Nothing here for now.</p>
                      </div>
                    )}
                  </div>
                  {!hasFilters && visible.filter((item) => item.kind === lane).length > 3 && (
                    <button
                      className={styles.laneExpand}
                      aria-expanded={expandedLanes.includes(lane)}
                      aria-controls={`action-lane-${lane}`}
                      onClick={() =>
                        setExpandedLanes((current) =>
                          current.includes(lane)
                            ? current.filter((value) => value !== lane)
                            : [...current, lane],
                        )
                      }
                    >
                      {expandedLanes.includes(lane)
                        ? 'Show less'
                        : `Show ${visible.filter((item) => item.kind === lane).length - 3} more ${visible.filter((item) => item.kind === lane).length === 4 ? kindLabels[lane].toLowerCase().replace(/s$/, '') : kindLabels[lane].toLowerCase()}`}
                      <ChevronDown size={16} aria-hidden="true" />
                    </button>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <ListTodo size={34} aria-hidden="true" />
              <h2>{records.length ? 'No items match these filters' : 'Room for your next move'}</h2>
              <p>
                {records.length
                  ? 'Try a different search or clear your filters.'
                  : 'Tasks, follow-ups, and risks appear here as they emerge.'}
              </p>
              {hasFilters && (
                <button className="btn" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          )}
          <p className={styles.collectionNote}>
            <Sparkles size={14} aria-hidden="true" />
            Extracted from {messages.length} loaded Slack messages. Review each source before
            acting.
          </p>
        </section>
      )}
    </div>
  );
}

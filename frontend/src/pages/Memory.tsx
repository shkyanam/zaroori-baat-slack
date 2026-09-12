import { channelName, channelOptions } from '../slackIdentity';
import SlackSource from '../components/SlackSource';
import StatusPill, { ConfidencePill } from '../components/StatusPill';
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { Message } from '../types';
import styles from './Pages.module.css';

function dateLabel(value?: string) {
  if (!value) return 'Date not identified';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function sourceId(metadata?: Record<string, unknown>) {
  const id = metadata?.source_message_id;
  if (typeof id === 'string' && id) return id;
  const ids = metadata?.source_message_ids;
  if (typeof ids === 'string') return ids.split(',')[0]?.trim();
  if (Array.isArray(ids) && typeof ids[0] === 'string') return ids[0];
  return undefined;
}
export default function Memory({
  messages,
  loading = false,
  failed = false,
}: {
  messages: Message[];
  loading?: boolean;
  failed?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState('all');
  const system = useQuery({ queryKey: ['system'], queryFn: api.system, staleTime: 30_000 });
  const search = useMutation({ mutationFn: api.memory });
  const sync = useMutation({
    mutationFn: api.syncMemory,
    onSuccess: () => {
      if (search.variables) search.mutate(search.variables);
    },
  });
  const decisions = useMemo(() => {
    const byId = new Map(messages.map((message) => [message.id, message]));
    const candidates = messages.flatMap((message) =>
      (message.decision_memory?.items || []).map((decision) => {
        const sourceIds = [
          ...new Set(
            decision.source_message_ids?.filter(Boolean).length
              ? decision.source_message_ids.filter(Boolean)
              : [message.id],
          ),
        ].sort();
        const ownSource = sourceIds.includes(message.id);
        const source = ownSource
          ? message
          : sourceIds.map((id) => byId.get(id)).find((value): value is Message => Boolean(value)) ||
            message;
        const key = JSON.stringify([
          decision.decision.toLowerCase().replace(/\s+/g, ' ').trim(),
          sourceIds,
        ]);
        return { ...decision, message: source, sourceIds, ownSource, key };
      }),
    );
    const unique = new Map<string, (typeof candidates)[number]>();
    for (const record of candidates) {
      const previous = unique.get(record.key);
      if (!previous || (record.ownSource && !previous.ownSource)) unique.set(record.key, record);
    }
    return [...unique.values()];
  }, [messages]);
  const channels = channelOptions(decisions.map((item) => item.message));
  const visible = decisions.filter((item) => channel === 'all' || item.message.channel === channel);
  const pending = messages.filter(
    (message) =>
      message.classification === 'Decision Needed' &&
      !decisions.some((decision) => decision.sourceIds.includes(message.id)) &&
      message.decision !== 'dismissed',
  );
  const collectionLoading = loading && !messages.length;
  const collectionFailed = failed && !messages.length;
  const canSync = Boolean(
    system.data?.memory.active || (system.data?.memory.enabled && system.data?.memory.configured),
  );
  const showSearch = search.isPending || search.isError || search.isSuccess;
  const examples = [
    { label: 'The release', query: 'What did we decide about the release?' },
    { label: 'The reasoning', query: 'Why did we choose this approach?' },
    { label: 'Other options', query: 'Which alternatives were considered?' },
  ];
  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim() && !search.isPending) search.mutate(query.trim());
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageIntro}>
        <div>
          <p className="eyebrow">DECISIONS FROM YOUR SLACK CONVERSATIONS</p>
          <h1>
            Decision memory
            <span className={styles.headingDot} aria-hidden="true">
              .
            </span>
          </h1>
          <p className={styles.introCopy}>The outcome. The reasoning. Right where you need it.</p>
        </div>
        {canSync && (
          <button className="btn" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw size={16} className={sync.isPending ? styles.spin : ''} aria-hidden="true" />
            {sync.isPending ? 'Syncing memory…' : 'Sync saved decisions'}
          </button>
        )}
      </header>
      {sync.isError && (
        <div className={styles.error} role="alert">
          <span>{sync.error.message}</span>
          <button className="btn" onClick={() => sync.mutate()}>
            Retry sync
          </button>
        </div>
      )}
      {sync.isSuccess && (
        <p className={styles.notice} role="status">
          <Check size={16} aria-hidden="true" />
          {sync.data.status === 'disabled'
            ? 'Memory sync is not configured. Local decision search is still available.'
            : sync.data.status === 'partial'
              ? `Synced ${sync.data.synced ?? 0} decisions. Some could not be synced; retry to try those again.`
              : `Memory sync complete. ${sync.data.synced ?? 0} saved decisions synced.`}
        </p>
      )}

      <section className={styles.memorySearch} aria-label="Search decision memory">
        <div className={styles.memorySearchContent}>
          <div className={styles.memorySearchHeading}>
            <Sparkles size={20} aria-hidden="true" />
            <h2>Pick up where your team left off.</h2>
          </div>
          <form className={styles.memoryForm} onSubmit={submit}>
            <label className={`search-field ${styles.search}`}>
              <Search size={19} aria-hidden="true" />
              <span className="sr-only">Search decision memory</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="What did we decide about…?"
              />
            </label>
            <button
              className="btn primary"
              type="submit"
              disabled={!query.trim() || search.isPending}
            >
              {search.isPending ? (
                <RefreshCw size={18} className={styles.spin} aria-hidden="true" />
              ) : (
                <ArrowRight size={18} aria-hidden="true" />
              )}
              <span>{search.isPending ? 'Searching…' : 'Search memory'}</span>
            </button>
          </form>
          <div className={styles.examples}>
            <span>Try</span>
            {examples.map((example) => (
              <button
                disabled={search.isPending}
                key={example.query}
                title={example.query}
                onClick={() => {
                  setQuery(example.query);
                  search.mutate(example.query);
                }}
              >
                {example.label}
                <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <div className={styles.memoryArt} aria-hidden="true">
          <div className={styles.artOrbit} />
          <span className={styles.artSpark}>
            <Sparkles size={21} />
          </span>
          <span className={styles.artNote}>
            <BookOpen size={37} />
          </span>
          <span className={styles.artCheck}>
            <Check size={21} />
          </span>
        </div>
      </section>

      {showSearch && (
        <section
          className={styles.results}
          aria-label="Memory search results"
          aria-busy={search.isPending}
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className="eyebrow">WHAT WE FOUND</p>
              <h2>{search.variables}</h2>
            </div>
            <button
              className="btn ghost"
              onClick={() => {
                search.reset();
                setQuery('');
              }}
              disabled={search.isPending}
            >
              <X size={15} aria-hidden="true" />
              Clear search
            </button>
          </div>
          {search.isPending && (
            <div className={styles.searchLoading} role="status">
              <RefreshCw size={24} className={styles.spin} aria-hidden="true" />
              <p>Looking through saved decisions…</p>
            </div>
          )}
          {search.isError && (
            <div className={styles.error} role="alert">
              <div>
                <strong>We couldn’t search memory</strong>
                <p>{search.error.message}</p>
              </div>
              <button
                className="btn"
                onClick={() => search.variables && search.mutate(search.variables)}
              >
                Try again
              </button>
            </div>
          )}
          {search.isSuccess &&
            (search.data.matches.length > 0 ? (
              <>
                {search.data.answer && (
                  <div className={styles.answer}>
                    <div className={styles.cardMeta}>
                      <Sparkles size={17} aria-hidden="true" />
                      <strong>From your decision records</strong>
                      <StatusPill tone="memory" icon={Database} className={styles.provider}>
                        {search.data.provider === 'local'
                          ? 'Local search'
                          : search.data.provider === 'mem0'
                            ? 'Memory search'
                            : search.data.provider}
                      </StatusPill>
                    </div>
                    <p>{search.data.answer}</p>
                  </div>
                )}
                <div className={styles.sectionHeading}>
                  <h3>Supporting records</h3>
                  <StatusPill tone="memory" icon={BookOpen}>
                    {search.data.matches.length}{' '}
                    {search.data.matches.length === 1 ? 'match' : 'matches'}
                  </StatusPill>
                </div>
                <div className={styles.evidenceGrid}>
                  {search.data.matches.map((match, index) => {
                    const id = sourceId(match.metadata);
                    const source = messages.find((message) => message.id === id);
                    const rawChannel =
                      typeof match.metadata?.channel === 'string'
                        ? match.metadata.channel
                        : source?.channel;
                    const matchChannel = channelName({
                      channel: rawChannel,
                      channel_name:
                        typeof match.metadata?.channel_name === 'string'
                          ? match.metadata.channel_name
                          : rawChannel === source?.channel
                            ? source?.channel_name
                            : undefined,
                    });
                    return (
                      <article
                        key={`${match.id || 'match'}-${index}`}
                        className={styles.evidenceCard}
                      >
                        <div className={styles.cardMeta}>
                          <span className={styles.recordNumber}>{index + 1}</span>
                          {matchChannel ? (
                            <SlackSource channel={matchChannel} />
                          ) : (
                            <StatusPill tone="memory" icon={BookOpen}>
                              Saved decision
                            </StatusPill>
                          )}
                          {match.created_at && (
                            <StatusPill icon={CalendarDays}>
                              <time dateTime={match.created_at}>{dateLabel(match.created_at)}</time>
                            </StatusPill>
                          )}
                        </div>
                        <p className={styles.memoryText}>{match.memory}</p>
                        {id && (
                          <Link
                            className={styles.sourceLink}
                            to={`/inbox?message=${encodeURIComponent(id)}`}
                          >
                            View source message <ArrowUpRight size={15} aria-hidden="true" />
                          </Link>
                        )}
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className={styles.empty}>
                <BookOpen size={32} aria-hidden="true" />
                <h3>No matching decision found</h3>
                <p>Try a project, topic, or phrase from the original conversation.</p>
              </div>
            ))}
        </section>
      )}

      <section aria-label="Extracted decisions" aria-busy={collectionLoading}>
        <div className={styles.sectionHeading}>
          <h2>
            Decisions on record{' '}
            <span className={styles.inlineCount}>
              {collectionLoading || collectionFailed ? '—' : decisions.length}
            </span>
          </h2>
          {channels.length > 1 && (
            <label className={styles.selectLabel}>
              <span className="sr-only">Filter decisions by channel</span>
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                aria-label="Filter decisions by channel"
              >
                <option value="all">All channels</option>
                {channels.map((value) => (
                  <option key={value.value} value={value.value}>
                    #{value.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {collectionLoading ? (
          <div className={styles.decisionGrid} role="status" aria-label="Loading decision records">
            {[0, 1].map((value) => (
              <div className={styles.loadingCard} key={value}>
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : collectionFailed ? (
          <div className={styles.empty}>
            <CircleAlert size={32} aria-hidden="true" />
            <h3>Decision records are unavailable</h3>
            <p>Use Retry above to browse decisions, or search saved memory directly.</p>
          </div>
        ) : visible.length ? (
          <div className={styles.decisionGrid}>
            {visible.map((decision, index) => (
              <article
                className={styles.decisionCard}
                key={decision.key}
                data-message-id={decision.message.id}
              >
                <div className={styles.decisionTop}>
                  <span className={styles.decisionMark} aria-hidden="true">
                    <BookOpen size={21} />
                  </span>
                  <SlackSource channel={channelName(decision.message)} />
                  <span className={styles.decisionIndex} aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3>{decision.decision}</h3>
                <div className={styles.decisionMeta}>
                  <StatusPill icon={CalendarDays}>{dateLabel(decision.date)}</StatusPill>
                  {decision.confidence && <ConfidencePill confidence={decision.confidence} />}
                  {!!decision.participants?.length && (
                    <div
                      className={styles.participantPills}
                      aria-label={`Participants: ${decision.participants.join(', ')}`}
                    >
                      {decision.participants.slice(0, 2).map((name, i) => (
                        <StatusPill icon={UserRound} key={`${name}-${i}`} title={name}>
                          {name}
                        </StatusPill>
                      ))}
                      {decision.participants.length > 2 && (
                        <StatusPill icon={Users} title={decision.participants.slice(2).join(', ')}>
                          +{decision.participants.length - 2}
                        </StatusPill>
                      )}
                    </div>
                  )}
                </div>
                <details className={styles.decisionDetails}>
                  <summary>
                    Why this decision
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className={styles.detailContent}>
                    <p className="field-label">Rationale</p>
                    <p>
                      {decision.rationale ||
                        'A rationale was not identified in the available context.'}
                    </p>
                    {!!decision.alternatives_considered?.length && (
                      <>
                        <p className="field-label">Alternatives considered</p>
                        <ul>
                          {decision.alternatives_considered.map((alternative, i) => (
                            <li key={`${alternative}-${i}`}>{alternative}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {decision.participants && decision.participants.length > 2 && (
                      <div className={styles.participantPills} aria-label="All participants">
                        {decision.participants.map((name, i) => (
                          <StatusPill icon={UserRound} key={`${name}-${i}`}>
                            {name}
                          </StatusPill>
                        ))}
                      </div>
                    )}
                    {(!decision.participants?.length || !decision.confidence) && (
                      <div className={styles.metadataPills}>
                        {!decision.participants?.length && (
                          <StatusPill icon={Users}>Participants not identified</StatusPill>
                        )}
                        {!decision.confidence && <StatusPill>Confidence unavailable</StatusPill>}
                      </div>
                    )}
                  </div>
                </details>
                <footer className={styles.decisionFooter}>
                  <StatusPill tone="memory" icon={Sparkles}>
                    Extracted decision
                  </StatusPill>
                  <Link
                    className={styles.sourceLink}
                    to={`/inbox?message=${encodeURIComponent(decision.message.id)}`}
                  >
                    View source <ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <Database size={34} aria-hidden="true" />
            <h3>
              {decisions.length ? 'No decisions in this channel' : 'A shared memory starts here'}
            </h3>
            <p>
              {decisions.length
                ? 'Choose another channel to browse its decisions.'
                : 'Decisions and their context will appear here as they are identified.'}
            </p>
          </div>
        )}
        {decisions.length > 0 && (
          <p className={styles.collectionNote}>
            <Sparkles size={14} aria-hidden="true" />
            From your loaded Slack messages. Open a source to confirm the original context.
          </p>
        )}
      </section>

      {pending.length > 0 && (
        <section className={styles.pendingSection} aria-label="Pending decision requests">
          <details>
            <summary className={styles.pendingSummary}>
              <span className={styles.pendingIcon}>
                <ArrowUpRight size={23} aria-hidden="true" />
              </span>
              <span>
                <strong>Still awaiting a decision</strong>
                <span>
                  {pending.length}{' '}
                  {pending.length === 1 ? 'conversation needs' : 'conversations need'} an outcome
                </span>
              </span>
              <ChevronDown size={19} aria-hidden="true" />
            </summary>
            <div className={styles.pendingList}>
              {pending.map((message) => (
                <Link
                  className={styles.pendingRow}
                  key={message.id}
                  to={`/inbox?message=${encodeURIComponent(message.id)}`}
                >
                  <div>
                    <span className={styles.metadataPills}>
                      <StatusPill tone="memory" icon={BookOpen}>
                        Decision requested
                      </StatusPill>
                      <SlackSource channel={channelName(message)} />
                    </span>
                    <p>{message.text}</p>
                  </div>
                  <ArrowUpRight size={19} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}

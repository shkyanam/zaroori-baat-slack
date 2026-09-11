import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  Layers3,
  RefreshCw,
  Settings2,
  Slack,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import { api } from '../api';
import styles from './Pages.module.css';

function dateTime(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}
function duration(value?: number) {
  if (value === undefined || value === null) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

export default function System({
  density,
  onDensityChange,
}: {
  density: 'comfortable' | 'compact';
  onDensityChange: (value: 'comfortable' | 'compact') => void;
}) {
  const status = useQuery({ queryKey: ['system'], queryFn: api.system, staleTime: 30_000 });
  const observability = useQuery({
    queryKey: ['observability'],
    queryFn: api.observability,
    staleTime: 15_000,
  });
  const metrics = observability.data?.metrics;
  const total = metrics?.total_runs ?? 0;
  const completed = metrics?.completed_runs ?? 0;
  const completionRate = total ? Math.round((completed / total) * 100) : 0;
  const classificationEntries = Object.entries(metrics?.classifications || {}).sort(
    (a, b) => b[1] - a[1],
  );
  const maximum = Math.max(1, ...classificationEntries.map(([, count]) => count));
  const refreshing = status.isFetching || observability.isFetching;
  const memoryConfigured = Boolean(
    status.data?.memory.active || (status.data?.memory.enabled && status.data?.memory.configured),
  );

  return (
    <div className={styles.page}>
      <header className={styles.pageIntro}>
        <div>
          <p className="eyebrow">YOUR WORKSPACE, WORKING FOR YOU</p>
          <h1>
            System & preferences
            <span className={styles.headingDot} aria-hidden="true">
              .
            </span>
          </h1>
          <p className={styles.introCopy}>A quick pulse check. A little room to make it yours.</p>
        </div>
        <button
          className="btn"
          disabled={refreshing}
          onClick={() => {
            void status.refetch();
            void observability.refetch();
          }}
        >
          <RefreshCw size={16} aria-hidden="true" className={refreshing ? styles.spin : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh status'}
        </button>
      </header>

      <section aria-label="Integration status">
        <div className={styles.sectionHeading}>
          <h2>Your connections</h2>
          {status.isSuccess && (
            <span className={styles.liveLabel}>
              <span />
              Local API responding
            </span>
          )}
        </div>
        {status.isError && (
          <div className={styles.error} role="alert">
            <div>
              <strong>Couldn’t load system status</strong>
              <p>{status.error.message}</p>
            </div>
            <button className="btn" onClick={() => void status.refetch()}>
              Retry
            </button>
          </div>
        )}
        {status.isPending ? (
          <div
            className={styles.integrationGrid}
            aria-busy="true"
            aria-label="Loading integration configuration"
          >
            {[0, 1, 2, 3].map((value) => (
              <div key={value} className={styles.loadingCard}>
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : (
          status.data && (
            <div className={styles.integrationGrid}>
              <article className={styles.integrationCard}>
                <div className={styles.integrationTop}>
                  <span className={styles.connectionIcon}>
                    <Slack size={27} aria-hidden="true" />
                  </span>
                  <span
                    className={`${styles.statusDot} ${status.data.slack.configured ? styles.dotGood : ''}`}
                    aria-hidden="true"
                  />
                </div>
                <h3>Slack</h3>
                <span
                  className={`${styles.statusPill} ${status.data.slack.configured ? styles.statusGood : styles.statusNeutral}`}
                >
                  {status.data.slack.configured ? 'Configured' : 'Not configured'}
                </span>
                <details className={styles.integrationDetails}>
                  <summary>
                    Connection details <ChevronDown size={14} aria-hidden="true" />
                  </summary>
                  <p>
                    {status.data.slack.configured
                      ? `${status.data.slack.channel_count} channels set up for sync.`
                      : 'Add Slack credentials and channels in the server configuration.'}
                  </p>
                  <span className="field-label">Last successful sync</span>
                  <p>
                    {status.data.slack.last_sync_at
                      ? dateTime(status.data.slack.last_sync_at)
                      : 'No successful sync recorded'}
                  </p>
                </details>
              </article>
              <article className={styles.integrationCard}>
                <div className={styles.integrationTop}>
                  <span className={`${styles.connectionIcon} ${styles.lavender}`}>
                    <Sparkles size={27} aria-hidden="true" />
                  </span>
                  <span className={`${styles.statusDot} ${styles.dotAmber}`} aria-hidden="true" />
                </div>
                <h3>Context enrichment</h3>
                <span className={`${styles.statusPill} ${styles.statusAmber}`}>Mock sources</span>
                <details className={styles.integrationDetails}>
                  <summary>
                    Connection details <ChevronDown size={14} aria-hidden="true" />
                  </summary>
                  <p>External work items, builds, incidents, and PR evidence use mock sources.</p>
                  <span className="field-label">Synthesis</span>
                  <p>{status.data.context.enabled ? 'AI enabled' : 'Fallback analysis'}</p>
                </details>
              </article>
              <article className={styles.integrationCard}>
                <div className={styles.integrationTop}>
                  <span className={styles.connectionIcon}>
                    <Database size={27} aria-hidden="true" />
                  </span>
                  <span className={`${styles.statusDot} ${styles.dotGood}`} aria-hidden="true" />
                </div>
                <h3>Decision memory</h3>
                <span
                  className={`${styles.statusPill} ${memoryConfigured ? styles.statusGood : styles.statusNeutral}`}
                >
                  {memoryConfigured ? 'Configured' : 'Local only'}
                </span>
                <details className={styles.integrationDetails}>
                  <summary>
                    Connection details <ChevronDown size={14} aria-hidden="true" />
                  </summary>
                  <p>
                    {memoryConfigured
                      ? 'Mem0 storage and retrieval configured. Local records remain available as a fallback.'
                      : 'Search is available in the local SQLite database. Mem0 sync is not configured.'}
                  </p>
                </details>
              </article>
              <article className={styles.integrationCard}>
                <div className={styles.integrationTop}>
                  <span className={`${styles.connectionIcon} ${styles.peach}`}>
                    <Waypoints size={27} aria-hidden="true" />
                  </span>
                  <span className={styles.statusDot} aria-hidden="true" />
                </div>
                <h3>Agent workflow</h3>
                <span className={`${styles.statusPill} ${styles.statusNeutral}`}>
                  {status.data.workflow.engine || 'Workflow'}
                </span>
                <details className={styles.integrationDetails}>
                  <summary>
                    Connection details <ChevronDown size={14} aria-hidden="true" />
                  </summary>
                  <p>
                    Four agents identify signals, gather context, extract actions, and preserve
                    decisions.
                  </p>
                  <span className="field-label">Checkpointer</span>
                  <p>{status.data.workflow.checkpointer || 'Not reported'}</p>
                </details>
              </article>
            </div>
          )
        )}
        <p className={styles.collectionNote}>
          Configured means settings are present. A successful sync confirms access.
        </p>
      </section>

      <section className={styles.preferences} aria-label="Display preferences">
        <div className={styles.preferenceHeading}>
          <span className={styles.preferenceIcon}>
            <Settings2 size={26} aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">MAKE YOURSELF AT HOME</p>
            <h2>A little space, or a little more?</h2>
            <p>Inbox density · saved in this browser</p>
          </div>
        </div>
        <div className={styles.densityOptions} role="group" aria-label="Inbox density">
          {(['comfortable', 'compact'] as const).map((value) => (
            <button
              className={density === value ? styles.selectedDensity : ''}
              key={value}
              onClick={() => onDensityChange(value)}
              aria-pressed={density === value}
            >
              <span
                className={`${styles.densityPreview} ${value === 'compact' ? styles.compactPreview : ''}`}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
              </span>
              <span>
                {value === 'comfortable' ? 'Comfortable' : 'Compact'}
                {density === value && <Check size={15} aria-hidden="true" />}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Workflow metrics">
        <div className={styles.sectionHeading}>
          <h2>Behind the scenes</h2>
          <span className={styles.quietLabel}>
            <Activity size={15} aria-hidden="true" />
            Recorded workflow activity
          </span>
        </div>
        {observability.isError && (
          <div className={styles.error} role="alert">
            <div>
              <strong>Couldn’t load workflow activity</strong>
              <p>{observability.error.message}</p>
            </div>
            <button className="btn" onClick={() => void observability.refetch()}>
              Retry
            </button>
          </div>
        )}
        <div className={styles.workflowOverview} aria-busy={observability.isPending}>
          <div className={styles.completionVisual}>
            <div
              className={styles.completionRing}
              style={{
                background: `conic-gradient(var(--accent) ${completionRate * 3.6}deg, var(--focus-raised) 0deg)`,
              }}
            >
              <div>
                <strong>{metrics && total ? `${completionRate}%` : '—'}</strong>
                <span>completed</span>
              </div>
            </div>
            <span>
              {total
                ? `${completed.toLocaleString()} of ${total.toLocaleString()} runs`
                : observability.isPending
                  ? 'Loading activity…'
                  : observability.isError
                    ? 'Activity unavailable'
                    : 'No recorded runs'}
            </span>
          </div>
          <div className={styles.workflowContent}>
            <div className={styles.workflowPath} aria-label="Agent processing stages">
              {[
                { icon: Activity, label: 'Detect' },
                { icon: Sparkles, label: 'Enrich' },
                { icon: Layers3, label: 'Extract' },
                { icon: Database, label: 'Remember' },
              ].map(({ icon: Icon, label }, i) => (
                <div className={styles.workflowStage} key={label}>
                  <span>
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <strong>{label}</strong>
                  {i < 3 && (
                    <ArrowRight className={styles.stageArrow} size={17} aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
            <div className={styles.metricGrid}>
              {[
                ['Total runs', metrics?.total_runs?.toLocaleString() ?? '—'],
                ['Completed', metrics?.completed_runs?.toLocaleString() ?? '—'],
                ['Failed', metrics?.failed_runs?.toLocaleString() ?? '—'],
                ['Average duration', duration(metrics?.average_duration_ms)],
              ].map(([label, value]) => (
                <div className={styles.metricCard} key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <details className={styles.systemDetails}>
          <summary>
            <span>
              <Activity size={18} aria-hidden="true" />
              Explore workflow details
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div className={styles.systemDetailsBody}>
            <div className={styles.activityGrid}>
              <article className={styles.activityCard}>
                <div className={styles.sectionHeading}>
                  <h3>Signals classified</h3>
                  <Layers3 size={18} aria-hidden="true" />
                </div>
                {classificationEntries.length ? (
                  <div className={styles.barList}>
                    {classificationEntries.map(([label, count]) => (
                      <div className={styles.barRow} key={label}>
                        <div>
                          <span>{label}</span>
                          <strong>{count}</strong>
                        </div>
                        <div className={styles.barTrack}>
                          <span style={{ width: `${(count / maximum) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.miniEmpty}>
                    <Activity size={24} aria-hidden="true" />
                    <p>
                      {observability.isPending
                        ? 'Loading recorded signals…'
                        : observability.isError
                          ? 'Signal counts are unavailable.'
                          : 'Classification counts appear after processing.'}
                    </p>
                  </div>
                )}
              </article>
              <article className={styles.activityCard}>
                <div className={styles.sectionHeading}>
                  <h3>LangSmith tracing</h3>
                  <Waypoints size={18} aria-hidden="true" />
                </div>
                <span
                  className={`${styles.statusPill} ${observability.data?.langsmith?.active ? styles.statusGood : styles.statusNeutral}`}
                >
                  {observability.data
                    ? observability.data.langsmith?.active
                      ? 'Configured'
                      : 'Not configured'
                    : 'Status unavailable'}
                </span>
                <p className={styles.traceCopy}>
                  Follow each processing step to investigate an unexpected result.
                </p>
                {observability.data?.langsmith?.project && (
                  <div className={styles.traceProject}>
                    <span className="field-label">Project</span>
                    <strong>{observability.data.langsmith.project}</strong>
                  </div>
                )}
                {observability.data?.langsmith?.active && (
                  <a
                    className={styles.sourceLink}
                    href="https://smith.langchain.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open LangSmith <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                )}
              </article>
            </div>
            <div className={styles.runPanel}>
              <div className={styles.sectionHeading}>
                <h3>Recent runs</h3>
                <span className="muted">Latest {observability.data?.recent_runs.length ?? 0}</span>
              </div>
              {observability.data?.recent_runs.length ? (
                <div className={styles.tableScroll}>
                  <table className={styles.runTable}>
                    <thead>
                      <tr>
                        <th scope="col">Run</th>
                        <th scope="col">Channel / signal</th>
                        <th scope="col">Status</th>
                        <th scope="col">Duration</th>
                        <th scope="col">Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {observability.data.recent_runs.map((run) => (
                        <tr key={run.run_id}>
                          <td>
                            <span className={styles.runId} title={run.run_id}>
                              {run.run_id.slice(0, 10)}
                            </span>
                            {run.error && (
                              <details className={styles.runError}>
                                <summary>Error details</summary>
                                <p>{run.error}</p>
                              </details>
                            )}
                          </td>
                          <td>
                            <span>
                              {run.channel
                                ? `#${run.channel.replace(/^#/, '')}`
                                : 'Channel unavailable'}
                            </span>
                            <small>{run.classification || 'Classification unavailable'}</small>
                          </td>
                          <td>
                            <span
                              className={`${styles.statusPill} ${run.status === 'completed' || run.status === 'complete' ? styles.statusGood : run.status === 'failed' ? styles.statusBad : styles.statusNeutral}`}
                            >
                              {run.status}
                            </span>
                          </td>
                          <td>{duration(run.duration_ms)}</td>
                          <td>{dateTime(run.started_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.miniEmpty}>
                  <CircleAlert size={25} aria-hidden="true" />
                  <p>
                    {observability.isPending
                      ? 'Loading recent runs…'
                      : observability.isError
                        ? 'Recent runs are unavailable. Retry above.'
                        : 'No workflow runs recorded yet.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}

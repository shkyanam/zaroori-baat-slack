import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  Hash,
  Layers3,
  ListTodo,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import type { Message, ReviewDecision } from '../types';
import { api } from '../api';
import styles from './MessageDetail.module.css';

const steps = ['Understand', 'Prepare', 'Decide'] as const;
function concise(text: string, limit = 110) {
  const clean = text
    .replace(/<@([^>]+)>/g, '@$1')
    .replace(/^@\S+\s+/, '')
    .trim();
  const sentence = clean.match(/^(.+?[.!?])(?:\s|$)/)?.[1] || clean;
  return sentence.length > limit ? `${sentence.slice(0, limit).replace(/\s+\S*$/, '')}…` : sentence;
}

export default function MessageDetail({
  message,
  onClose,
  notify,
  onNext,
  nextCount = 0,
}: {
  message: Message;
  onClose: () => void;
  notify: (text: string) => void;
  onNext?: () => void;
  nextCount?: number;
}) {
  const client = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [step, setStep] = useState(message.decision ? 2 : 0);
  const [savedDecision, setSavedDecision] = useState<ReviewDecision | null>(
    message.decision || null,
  );
  const [justSaved, setJustSaved] = useState(false);
  const draftKey = `zb-draft-${message.id}`;
  const proposed = message.context?.suggested_response || '';
  const [draft, setDraft] = useState(() => {
    try {
      return sessionStorage.getItem(draftKey) ?? proposed;
    } catch {
      return proposed;
    }
  });
  const [dirty, setDirty] = useState(() => {
    try {
      return sessionStorage.getItem(draftKey) !== null;
    } catch {
      return false;
    }
  });
  const [copying, setCopying] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const context = message.context || {};
  const items = message.action_extraction?.items || [];
  const decisions = message.decision_memory?.items || [];
  const related = context.related_messages || [];
  const ownItems = items.filter((item) => item.source_message_ids?.includes(message.id));
  const owner = ownItems.find((item) => item.owner)?.owner;
  const due = ownItems.find((item) => item.due)?.due;
  const title = concise(message.text);
  const currentAction =
    ownItems.find((item) => item.type !== 'Risk')?.title || message.suggested_action;
  useEffect(() => {
    setSavedDecision(message.decision || null);
  }, [message.decision, message.id]);
  useEffect(() => {
    stepRefs.current[message.decision ? 2 : 0]?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!dirty) setDraft(proposed);
  }, [proposed, dirty]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [step]);
  useEffect(
    () => () => {
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
    },
    [],
  );
  const review = useMutation({
    mutationFn: (decision: ReviewDecision | 'pending') => api.review(message.id, decision),
    onSuccess: (_result, decision) => {
      setSavedDecision(decision === 'pending' ? null : decision);
      setJustSaved(decision !== 'pending');
      setStep(decision === 'pending' ? 0 : 2);
      void client.invalidateQueries({ queryKey: ['messages'] });
    },
  });
  const enrich = useMutation({
    mutationFn: () => api.enrich(message.id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['messages'] });
      void client.invalidateQueries({ queryKey: ['observability'] });
      notify('Analysis refreshed. Your local draft has been kept.');
    },
  });
  const changeDraft = (value: string) => {
    setDraft(value);
    setDirty(true);
    setCopyFeedback(null);
    setCopying(false);
    try {
      sessionStorage.setItem(draftKey, value);
    } catch {
      /* Preserve it in memory. */
    }
  };
  const resetDraft = () => {
    setDraft(proposed);
    setDirty(false);
    setCopyFeedback(null);
    setCopying(false);
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      /* Reset it in memory. */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopying(true);
      setCopyFeedback({ text: 'Response copied. You can paste it into Slack.', error: false });
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopying(false), 1800);
    } catch {
      setCopyFeedback({
        text: 'Clipboard unavailable. Select the response text and copy it manually.',
        error: true,
      });
    }
  };
  const confidence = ['high', 'medium', 'low'].includes(context.confidence || '')
    ? context.confidence
    : 'not provided';
  const safePermalink = (() => {
    try {
      const url = new URL(message.permalink || '');
      return url.protocol === 'https:' &&
        (url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com'))
        ? url.href
        : null;
    } catch {
      return null;
    }
  })();
  const receiptTitle =
    savedDecision === 'approved'
      ? 'Approval recorded'
      : savedDecision === 'deferred'
        ? 'Set aside for later'
        : savedDecision === 'dismissed'
          ? 'A little less noise.'
          : 'Escalation recorded';
  const receiptDescription =
    savedDecision === 'approved'
      ? 'Your review is saved. No Slack reply or task was sent.'
      : savedDecision === 'deferred'
        ? 'Find this conversation in Deferred when you’re ready. No reminder is scheduled.'
        : savedDecision === 'dismissed'
          ? 'This conversation is out of your review queue. You can find it in Reviewed.'
          : 'Your review is saved. No external action was sent.';

  return (
    <section className={styles.detail} aria-label="Message detail">
      <header className={styles.detailHeader}>
        <span className={styles.headerMark}>
          <Sparkles size={18} />
        </span>
        <span className={styles.headerTitle}>One conversation at a time</span>
        {safePermalink && (
          <a href={safePermalink} target="_blank" rel="noreferrer" className={styles.slackLink}>
            Open in Slack <ArrowUpRight size={15} />
          </a>
        )}
        <button className={styles.closeButton} aria-label="Close message detail" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <nav className={styles.steps} aria-label="Review steps">
        {steps.map((label, index) => (
          <button
            key={label}
            ref={(element) => {
              stepRefs.current[index] = element;
            }}
            aria-label={label}
            aria-current={step === index ? 'step' : undefined}
            className={`${styles.step} ${step === index ? styles.activeStep : ''} ${step > index ? styles.completedStep : ''}`}
            onClick={() => setStep(index)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                const next = (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
                setStep(next);
                stepRefs.current[next]?.focus();
              }
            }}
          >
            <span className={styles.stepNumber}>
              {step > index ? <Check size={13} /> : `0${index + 1}`}
            </span>
            {label}
            <span className={styles.stepLine} />
          </button>
        ))}
      </nav>
      <div ref={scrollRef} className={styles.scrollContent}>
        <div className={styles.stepContent} key={`${message.id}-${step}`}>
          {step === 0 && (
            <>
              <div className={styles.eyebrow}>
                <span className={`${styles.priority} ${styles[message.priority]}`}>
                  <i />
                  {message.priority} priority
                </span>
                <span>
                  <Hash size={12} />
                  {message.channel.replace(/^#/, '')}
                </span>
              </div>
              <h2 className={styles.title}>{title}</h2>
              <p className={styles.rationale}>{concise(message.reason, 155)}</p>
              <div className={styles.glance}>
                <div>
                  <UserRound size={17} />
                  <span>
                    Owner<strong>{owner || 'Unassigned'}</strong>
                  </span>
                </div>
                <div>
                  <Clock3 size={17} />
                  <span>
                    Due<strong>{due || 'Not specified'}</strong>
                  </span>
                </div>
                <div>
                  <Layers3 size={17} />
                  <span>
                    Type<strong>{message.classification}</strong>
                  </span>
                </div>
              </div>
              {currentAction && (
                <div className={styles.nextMove}>
                  <span className={styles.nextMoveIcon}>
                    <ArrowUpRight size={23} />
                  </span>
                  <div>
                    <span>Suggested next move</span>
                    <strong>{concise(currentAction, 135)}</strong>
                  </div>
                </div>
              )}
              <div className={styles.evidenceStack}>
                <details className={styles.disclosure}>
                  <summary>
                    <span className={styles.sourceIcon}>
                      <MessageSquare size={17} />
                    </span>
                    <span>
                      <strong>Original message</strong>
                      <small>
                        {message.sender} ·{' '}
                        {new Date(message.created_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </span>
                    <ChevronDown className={styles.chevron} size={16} />
                  </summary>
                  <div className={styles.disclosureBody}>
                    <p className={styles.originalText}>
                      {message.text.replace(/<@([^>]+)>/g, '@$1')}
                    </p>
                    {!safePermalink && (
                      <span className={styles.quiet}>Source link not available</span>
                    )}
                  </div>
                </details>
                <details className={styles.disclosure}>
                  <summary>
                    <span className={`${styles.sourceIcon} ${styles.lavender}`}>
                      <FileText size={17} />
                    </span>
                    <span>
                      <strong>Context &amp; sources</strong>
                      <small>
                        {context.sources?.length || 0} sample sources · {related.length} related
                        messages
                      </small>
                    </span>
                    <ChevronDown className={styles.chevron} size={16} />
                  </summary>
                  <div className={styles.disclosureBody}>
                    <span className={styles.smallLabel}>Sample sources</span>
                    <p>
                      {context.briefing ||
                        context.summary ||
                        'Context is not available yet. Refresh analysis to try again.'}
                    </p>
                    {!!context.key_facts?.length && (
                      <ul className={styles.facts}>
                        {context.key_facts.map((fact, index) => (
                          <li key={index}>
                            <Check size={14} />
                            <span>{fact}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className={styles.sources}>
                      {(context.sources || []).map((source, index) => (
                        <details key={index}>
                          <summary>
                            <FileText size={14} />
                            {source.name}
                            <ChevronDown size={13} />
                          </summary>
                          <p>{source.detail}</p>
                        </details>
                      ))}
                    </div>
                    <p className={styles.quiet}>
                      External work, build, and incident findings are sample data.{' '}
                      {context.agent === 'llm'
                        ? 'Briefing synthesized with AI.'
                        : 'Briefing uses rule-based analysis.'}
                    </p>
                    {!!context.open_questions?.length && (
                      <div className={styles.questions}>
                        <strong>Still to clarify</strong>
                        <ul>
                          {context.open_questions.map((question, index) => (
                            <li key={index}>{question}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!!related.length && (
                      <details className={styles.relatedDisclosure}>
                        <summary>
                          <MessageCircle size={15} />
                          Related conversations ({related.length})<ChevronDown size={13} />
                        </summary>
                        <p className={styles.quiet}>
                          Retrieved from available Slack history. This may not be the complete
                          thread.
                        </p>
                        {related.map((item, index) => (
                          <article className={styles.relatedMessage} key={`${item.id}-${index}`}>
                            <div>
                              <strong>{item.sender}</strong>
                              <span>{item.channel}</span>
                            </div>
                            <p>{item.text.replace(/<@([^>]+)>/g, '@$1')}</p>
                            <small>{item.relationship || 'Related message'}</small>
                          </article>
                        ))}
                      </details>
                    )}
                    <details className={styles.analysis}>
                      <summary>
                        <ShieldCheck size={14} />
                        About this analysis
                        <ChevronDown size={13} />
                      </summary>
                      <p>
                        <strong>Signal score: {message.score}/100.</strong> Ranking by urgency and
                        action terms; not a probability.
                      </p>
                      <p>
                        <strong>Briefing confidence: {confidence}.</strong> Supplied by the analysis
                        when available.
                      </p>
                    </details>
                    <button
                      className={styles.textButton}
                      onClick={() => enrich.mutate()}
                      disabled={enrich.isPending}
                    >
                      <RefreshCw size={13} className={enrich.isPending ? 'spinning' : ''} />
                      {enrich.isPending ? 'Refreshing…' : 'Refresh analysis'}
                    </button>
                    {enrich.isError && (
                      <p className={styles.error} role="alert">
                        Analysis could not refresh: {enrich.error.message}
                      </p>
                    )}
                  </div>
                </details>
                {!!(items.length || decisions.length) && (
                  <details className={styles.disclosure}>
                    <summary>
                      <span className={`${styles.sourceIcon} ${styles.lime}`}>
                        <ListTodo size={17} />
                      </span>
                      <span>
                        <strong>Work &amp; decisions</strong>
                        <small>
                          {ownItems.length} work items from this message · includes related context
                        </small>
                      </span>
                      <ChevronDown className={styles.chevron} size={16} />
                    </summary>
                    <div className={styles.disclosureBody}>
                      <p className={styles.quiet}>
                        Extracted suggestions. Owners and deadlines come from the analysis; verify
                        them in the original discussion.
                      </p>
                      {items.map((item, index) => (
                        <article className={styles.workItem} key={index}>
                          <div>
                            <span className={styles.smallLabel}>{item.type}</span>
                            <small>
                              {item.source_message_ids?.includes(message.id)
                                ? 'This message'
                                : 'Related context'}
                            </small>
                          </div>
                          <h3>{item.title}</h3>
                          <div className={styles.workMeta}>
                            <span>
                              <UserRound size={12} />
                              {item.owner || 'No owner'}
                            </span>
                            <span>
                              <Clock3 size={12} />
                              {item.due || 'No due date'}
                            </span>
                          </div>
                          <small>
                            {item.confidence
                              ? `${item.confidence} confidence`
                              : 'Confidence not provided'}
                            {item.source && ` · ${item.source}`}
                          </small>
                        </article>
                      ))}
                      {decisions.map((decision, index) => (
                        <article
                          className={`${styles.workItem} ${styles.decisionItem}`}
                          key={`decision-${index}`}
                        >
                          <div>
                            <span className={styles.smallLabel}>
                              <BookOpen size={12} />
                              Extracted decision
                            </span>
                            <small>
                              {decision.source_message_ids?.includes(message.id)
                                ? 'This message'
                                : 'Related context'}
                            </small>
                          </div>
                          <h3>{decision.decision}</h3>
                          {decision.rationale && <p>{decision.rationale}</p>}
                          {!!decision.alternatives_considered?.length && (
                            <small>
                              Alternatives: {decision.alternatives_considered.join(', ')}
                            </small>
                          )}
                          {!!decision.participants?.length && (
                            <small>Participants: {decision.participants.join(', ')}</small>
                          )}
                        </article>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div className={styles.stepHeading}>
                <div className={`${styles.largeIcon} ${styles.lavender}`}>
                  <MessageCircle size={28} />
                </div>
                <div>
                  <span className={styles.stepEyebrow}>Make it yours</span>
                  <h2 className={styles.title}>A head start on your reply.</h2>
                  <p className={styles.rationale}>
                    Fine-tune the draft, then copy it when you’re ready.
                  </p>
                </div>
              </div>
              <div className={styles.draftCard}>
                <div className={styles.draftHeader}>
                  <span>
                    <Sparkles size={15} />
                    Suggested response
                  </span>
                  <span className={styles.smallLabel}>Draft · not sent</span>
                </div>
                <div className={styles.replyTo}>
                  <span className={styles.avatar}>
                    {message.sender
                      .replace(/[^a-z]/gi, '')
                      .slice(0, 2)
                      .toUpperCase() || 'SL'}
                  </span>
                  <span>
                    To {message.sender}
                    <small>{message.channel}</small>
                  </span>
                </div>
                <label className="sr-only" htmlFor={`draft-${message.id}`}>
                  Suggested response draft
                </label>
                <textarea
                  id={`draft-${message.id}`}
                  value={draft}
                  onChange={(event) => changeDraft(event.target.value)}
                  placeholder="No suggested reply yet. Write your own here…"
                  rows={4}
                />
                <div className={styles.draftFooter}>
                  <span>
                    {dirty
                      ? 'Edited locally · kept in this tab'
                      : 'Suggested draft · ready to edit'}
                  </span>
                  <div>
                    {dirty && (
                      <button
                        className={styles.closeButton}
                        aria-label="Reset response draft"
                        onClick={resetDraft}
                      >
                        <RotateCcw size={15} />
                      </button>
                    )}
                    <button
                      className={styles.secondaryButton}
                      onClick={() => void copy()}
                      disabled={!draft.trim()}
                    >
                      {copying ? <Check size={15} /> : <Copy size={15} />}
                      {copying ? 'Copied' : 'Copy response'}
                    </button>
                  </div>
                </div>
              </div>
              {copyFeedback && (
                <p
                  className={copyFeedback.error ? styles.error : styles.copyFeedback}
                  role={copyFeedback.error ? 'alert' : 'status'}
                >
                  {copyFeedback.text}
                </p>
              )}
              <p className={styles.scopeNote}>
                <ShieldCheck size={14} />
                Your edits stay in this browser tab. Approval records a review; it doesn’t send this
                reply.
              </p>
            </>
          )}
          {step === 2 &&
            (savedDecision ? (
              <div className={styles.receipt} role={justSaved ? 'status' : undefined}>
                <div className={styles.receiptArt}>
                  <span />
                  <span />
                  <span />
                  <div>
                    {savedDecision === 'deferred' ? <Clock3 size={38} /> : <CheckCheck size={38} />}
                  </div>
                </div>
                <span className={styles.stepEyebrow}>
                  {justSaved ? 'Saved. You’re all set.' : 'Previously reviewed'}
                </span>
                <h2 className={styles.title}>{receiptTitle}</h2>
                <p className={styles.rationale}>{receiptDescription}</p>
                <div className={styles.reviewedMessage}>
                  <MessageSquare size={18} />
                  <span>
                    {title}
                    <small>
                      {message.channel} · {message.sender}
                    </small>
                  </span>
                </div>
                <button
                  className={styles.textButton}
                  disabled={review.isPending}
                  onClick={() => review.mutate('pending')}
                >
                  <RotateCcw size={14} />
                  Reopen review
                </button>
              </div>
            ) : (
              <>
                <div className={`${styles.largeIcon} ${styles.lime}`}>
                  <CheckCheck size={28} />
                </div>
                <span className={styles.stepEyebrow}>The final say is yours</span>
                <h2 className={styles.title}>Ready to move this forward?</h2>
                <p className={styles.rationale}>
                  Approve the recommendation, or set it aside for later.
                </p>
                <div className={styles.decisionCard}>
                  <span className={styles.smallLabel}>Recommendation to review</span>
                  <h3>{currentAction || title}</h3>
                  <div>
                    <span>
                      <Hash size={13} />
                      {message.channel.replace(/^#/, '')}
                    </span>
                    <span>
                      <UserRound size={13} />
                      {owner || message.sender}
                    </span>
                  </div>
                  <p>Applies to this message’s recommendation. Extracted tasks stay unchanged.</p>
                </div>
                <div className={styles.scopeCard}>
                  <ShieldCheck size={22} />
                  <div>
                    <strong>You’re saving a review.</strong>
                    <span>No Slack reply, task, or external action will be sent.</span>
                  </div>
                </div>
              </>
            ))}
        </div>
      </div>
      <footer className={styles.reviewBar}>
        {review.isError && (
          <p role="alert" className={styles.error}>
            Your review wasn’t saved. {review.error.message} Please try again.
          </p>
        )}
        {savedDecision && step === 2 ? (
          <>
            <span className={styles.footerHint}>
              {nextCount > 0 ? `${nextCount} more to review` : 'You can revisit this anytime.'}
            </span>
            <button className={styles.primaryButton} onClick={onNext || onClose}>
              {onNext ? 'Next conversation' : 'Back to inbox'}
              <ArrowRight size={17} />
            </button>
          </>
        ) : (
          <>
            <div className={styles.secondaryActions}>
              {step > 0 && (
                <button
                  className={styles.backButton}
                  onClick={() => setStep(step - 1)}
                  aria-label="Previous step"
                >
                  <ArrowLeft size={17} />
                </button>
              )}
              {!savedDecision && (
                <>
                  <button
                    className={styles.textButton}
                    onClick={() => review.mutate('deferred')}
                    disabled={review.isPending}
                  >
                    <Clock3 size={15} />
                    Defer
                  </button>
                  <button
                    className={styles.textButton}
                    onClick={() => review.mutate('dismissed')}
                    disabled={review.isPending}
                  >
                    <X size={15} />
                    Dismiss
                  </button>
                </>
              )}
            </div>
            <button
              className={styles.primaryButton}
              disabled={review.isPending}
              onClick={() => (step < 2 ? setStep(step + 1) : review.mutate('approved'))}
            >
              {review.isPending
                ? 'Saving…'
                : step === 0
                  ? 'Review response'
                  : step === 1
                    ? 'Continue to decision'
                    : 'Approve review'}
              {review.isPending ? (
                <RefreshCw size={16} className="spinning" />
              ) : step === 2 ? (
                <Check size={17} />
              ) : (
                <ArrowRight size={17} />
              )}
            </button>
          </>
        )}
      </footer>
    </section>
  );
}

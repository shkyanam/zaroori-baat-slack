const queue = document.querySelector('#queue');
const toast = document.querySelector('#toast');
const syncButton = document.querySelector('#sync-button');
const refreshButton = document.querySelector('#refresh-button');
const memoryQuery = document.querySelector('#memory-query');
const memorySearchButton = document.querySelector('#memory-search-button');
const memorySyncButton = document.querySelector('#memory-sync-button');
const memoryStatus = document.querySelector('#memory-status');
const memoryResults = document.querySelector('#memory-results');
const observabilityRefreshButton = document.querySelector('#observability-refresh-button');
const observabilityWorkflowStatus = document.querySelector('#observability-workflow-status');
const observabilityLangsmithStatus = document.querySelector('#observability-langsmith-status');
const observabilityTotalRuns = document.querySelector('#observability-total-runs');
const observabilityCompletedRuns = document.querySelector('#observability-completed-runs');
const observabilityFailedRuns = document.querySelector('#observability-failed-runs');
const observabilityAverageDuration = document.querySelector('#observability-average-duration');
const observabilityRuns = document.querySelector('#observability-runs');
const observabilityClassifications = document.querySelector('#observability-classifications');
const labels = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };
const classificationTabs = document.querySelector('#classification-tabs');
const classifications = ['FYI', 'Action Required', 'Question', 'Incident', 'Escalation', 'Approval Request', 'Decision Needed'];
let messages = [];
let activeClassification = 'all';
classificationTabs.setAttribute('role', 'tablist');

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' })[c]); }
function notify(message) { toast.textContent = message; toast.classList.add('visible'); setTimeout(() => toast.classList.remove('visible'), 2200); }
function countId(classification) { return `#count-${classification.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`; }
function renderContext(message) {
  const context = message.context || {};
  const sources = Array.isArray(context.sources) ? context.sources : [];
  const sourceRows = sources.map((source) => `<div class="context-source"><span>${escapeHtml(source.name)}</span><p>${escapeHtml(source.detail)}</p></div>`).join('');
  const relatedMessages = Array.isArray(context.related_messages) ? context.related_messages : [];
  const relatedRows = relatedMessages.map((related) => `<article class="related-message"><div><strong>${escapeHtml(related.sender)} · ${escapeHtml(related.channel)}</strong><span>${escapeHtml(related.relationship || 'Related message')}</span></div><p>${escapeHtml(related.text)}</p></article>`).join('');
  const relatedHtml = relatedMessages.length ? `<details class="related-messages"><summary>Related Slack messages (${relatedMessages.length})</summary><div class="related-list">${relatedRows}</div></details>` : '';
  const facts = Array.isArray(context.key_facts) && context.key_facts.length ? `<div class="context-facts"><span>Key facts</span><ul>${context.key_facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul></div>` : '';
  const agentLabel = context.agent === 'llm' ? 'LLM synthesis' : 'Deterministic fallback';
  return `<section class="context-card"><div class="context-head"><div><span class="context-kicker">Context enrichment · ${agentLabel}</span><strong>${escapeHtml(context.status === 'complete' ? 'Context ready' : 'Context pending')}</strong></div><button class="context-refresh" type="button" data-enrich-id="${message.id}">Refresh context</button></div><p class="context-summary">${escapeHtml(context.briefing || context.summary || 'Context enrichment is pending.')}</p><div class="context-sources">${sourceRows}</div>${facts}${relatedHtml}<div class="suggested-response"><span>Suggested response ready.</span><p>${escapeHtml(context.suggested_response || 'No suggested response available yet.')}</p></div></section>`;
}
function renderActions(message) {
  const extraction = message.action_extraction || {};
  const items = Array.isArray(extraction.items) ? extraction.items : [];
  const agentLabel = extraction.agent === 'llm' ? 'LLM synthesis' : 'Deterministic fallback';
  const itemRows = items.map((item) => {
    const metadata = [
      item.owner ? `<span>Owner: ${escapeHtml(item.owner)}</span>` : '',
      item.due ? `<span>Due: ${escapeHtml(item.due)}</span>` : '',
      item.source ? `<span>Source: ${escapeHtml(item.source)}</span>` : '',
    ].filter(Boolean).join('');
    return `<article class="extracted-action"><div class="action-item-head"><span class="action-type ${escapeHtml(String(item.type || '').toLowerCase())}">${escapeHtml(item.type || 'Action')}</span><span class="action-confidence">${escapeHtml(item.confidence || 'medium')} confidence</span></div><strong>${escapeHtml(item.title || 'Untitled action')}</strong>${metadata ? `<div class="action-meta">${metadata}</div>` : ''}</article>`;
  }).join('');
  const empty = '<p class="action-empty">No explicit tasks, follow-ups, risks, or decisions found.</p>';
  return `<section class="action-card"><div class="action-card-head"><div><span class="context-kicker">Action extraction · ${agentLabel}</span><strong>${items.length ? `${items.length} action${items.length === 1 ? '' : 's'} found` : 'No actions found'}</strong></div></div><div class="extracted-actions">${itemRows || empty}</div></section>`;
}
function formatDecisionDate(value) {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function renderDecisionMemory(message) {
  const memory = message.decision_memory || {};
  const items = Array.isArray(memory.items) ? memory.items : [];
  if (!items.length) return '';
  const agentLabel = memory.agent === 'llm' ? 'LLM synthesis' : 'Deterministic fallback';
  const itemRows = items.map((item) => {
    const alternatives = Array.isArray(item.alternatives_considered) && item.alternatives_considered.length
      ? `<span>Alternatives: ${escapeHtml(item.alternatives_considered.join(', '))}</span>` : '';
    const participants = Array.isArray(item.participants) && item.participants.length
      ? `<span>Participants: ${escapeHtml(item.participants.join(', '))}</span>` : '';
    const date = formatDecisionDate(item.date);
    const rationale = item.rationale ? `<p class="decision-rationale">Reason: ${escapeHtml(item.rationale)}</p>` : '';
    const metadata = [
      alternatives,
      participants,
      date ? `<span>Date: ${escapeHtml(date)}</span>` : '',
      item.source ? `<span>Source: ${escapeHtml(item.source)}</span>` : '',
    ].filter(Boolean).join('');
    return `<article class="memory-item"><div class="memory-item-head"><span class="memory-label">Decision</span><span class="action-confidence">${escapeHtml(item.confidence || 'medium')} confidence</span></div><strong>${escapeHtml(item.decision || 'Decision recorded')}</strong>${rationale}${metadata ? `<div class="memory-meta">${metadata}</div>` : ''}</article>`;
  }).join('');
  return `<section class="decision-memory-card"><div class="decision-memory-head"><div><span class="context-kicker">Decision memory · ${agentLabel}</span><strong>${items.length} decision${items.length === 1 ? '' : 's'} recorded</strong></div></div><div class="memory-list">${itemRows}</div></section>`;
}
function renderMemorySearch(result) {
  const providerLabel = result.provider === 'mem0' ? 'Mem0 semantic search' : 'SQLite local fallback';
  const mem0Label = result.mem0 && result.mem0.active ? 'Mem0 connected' : 'Mem0 not enabled';
  memoryStatus.textContent = `${providerLabel} · ${mem0Label} · ${result.matches.length} match${result.matches.length === 1 ? '' : 'es'}`;
  const answer = result.answer ? `<div class="memory-answer"><strong>Answer</strong><br>${escapeHtml(result.answer)}</div>` : '';
  const rows = result.matches.map((match) => {
    const metadata = match.metadata || {};
    const details = [
      metadata.channel ? `<span>Channel: ${escapeHtml(metadata.channel)}</span>` : '',
      metadata.thread_ts ? `<span>Thread: ${escapeHtml(metadata.thread_ts)}</span>` : '',
      match.created_at ? `<span>Date: ${escapeHtml(formatDecisionDate(match.created_at))}</span>` : '',
      match.score !== null && match.score !== undefined ? `<span>Score: ${escapeHtml(String(match.score))}</span>` : '',
    ].filter(Boolean).join('');
    return `<article class="memory-result"><strong>${escapeHtml(match.memory)}</strong>${details ? `<div class="memory-result-meta">${details}</div>` : ''}</article>`;
  }).join('');
  memoryResults.innerHTML = `${answer}${rows || '<p class="action-empty">No matching stored decision was found.</p>'}`;
}
function renderObservability(summary) {
  const workflow = summary.workflow || {};
  const langsmith = summary.langsmith || {};
  const metrics = summary.metrics || {};
  observabilityWorkflowStatus.textContent = `LangGraph · ${escapeHtml(workflow.checkpointer || 'unknown')} checkpoints`;
  observabilityWorkflowStatus.className = 'status-pill healthy';
  observabilityLangsmithStatus.textContent = langsmith.active
    ? `LangSmith connected · ${escapeHtml(langsmith.project || 'default')}`
    : 'LangSmith not configured';
  observabilityLangsmithStatus.className = `status-pill ${langsmith.active ? 'healthy' : 'inactive'}`;
  observabilityTotalRuns.textContent = metrics.total_runs || 0;
  observabilityCompletedRuns.textContent = metrics.completed_runs || 0;
  observabilityFailedRuns.textContent = metrics.failed_runs || 0;
  observabilityAverageDuration.textContent = `${metrics.average_duration_ms || 0} ms`;
  const runs = Array.isArray(summary.recent_runs) ? summary.recent_runs : [];
  observabilityRuns.innerHTML = runs.length ? runs.map((run) => `<article class="observability-run"><div><strong>${escapeHtml(run.classification || 'Processing')}</strong><span class="run-status ${escapeHtml(run.status || '')}">${escapeHtml(run.status || 'unknown')}</span></div><p>${escapeHtml(run.channel || 'Slack')} · ${escapeHtml(String(run.duration_ms ?? '—'))} ms</p><small>${escapeHtml(run.run_id || '')}</small>${run.error ? `<em>${escapeHtml(run.error)}</em>` : ''}</article>`).join('') : '<p class="action-empty">No workflow runs recorded yet.</p>';
  const classifications = metrics.classifications || {};
  const classificationRows = Object.entries(classifications).map(([name, count]) => `<div class="classification-row"><span>${escapeHtml(name)}</span><strong>${escapeHtml(String(count))}</strong></div>`).join('');
  observabilityClassifications.innerHTML = classificationRows || '<p class="action-empty">No classifications recorded yet.</p>';
}
async function loadObservability() {
  const response = await fetch('/api/observability/summary');
  if (!response.ok) throw new Error();
  renderObservability(await response.json());
}
function updateTabs() {
  document.querySelector('#count-all').textContent = messages.length;
  classifications.forEach((classification) => {
    document.querySelector(countId(classification)).textContent = messages.filter((m) => (m.classification || 'FYI') === classification).length;
  });
  classificationTabs.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('role', 'tab');
    const selected = tab.dataset.classification === activeClassification;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
}
function render(nextMessages) {
  messages = nextMessages;
  const pending = messages.filter((m) => !m.decision);
  const visibleMessages = activeClassification === 'all'
    ? messages
    : messages.filter((m) => (m.classification || 'FYI') === activeClassification);
  document.querySelector('#total-count').textContent = messages.length;
  document.querySelector('#pending-count').textContent = pending.length;
  document.querySelector('#high-count').textContent = pending.filter((m) => m.priority === 'high').length;
  updateTabs();
  queue.innerHTML = visibleMessages.length ? visibleMessages.map((message) => {
    const actions = message.decision ? `<span class="decision">${escapeHtml(message.decision)}</span>` : `<div class="actions"><button data-id="${message.id}" data-decision="approved">Take action</button><button data-id="${message.id}" data-decision="deferred">Defer</button><button data-id="${message.id}" data-decision="dismissed">Dismiss</button></div>`;
    return `<article class="message ${message.priority} ${message.decision ? 'done' : ''}"><div class="message-head"><div class="message-labels"><span class="classification">${escapeHtml(message.classification || 'FYI')}</span><span class="priority">${labels[message.priority]}</span></div><span class="score">${message.score}/100 signal</span></div><p class="message-text">${escapeHtml(message.text)}</p><div class="metadata"><span>${escapeHtml(message.channel)}</span><span>from ${escapeHtml(message.sender)}</span><span>${new Date(message.created_at).toLocaleString()}</span></div><p class="reason">${escapeHtml(message.reason)}</p>${renderContext(message)}${renderActions(message)}${renderDecisionMemory(message)}<div class="message-footer"><span class="suggestion">${escapeHtml(message.suggested_action)}</span>${actions}</div></article>`;
  }).join('') : '<p class="empty-state">No messages in this classification yet.</p>';
}
async function load() { const response = await fetch('/api/messages'); if (!response.ok) throw new Error(); render((await response.json()).messages); }
classificationTabs.addEventListener('click', (event) => { const tab = event.target.closest('.tab'); if (!tab) return; activeClassification = tab.dataset.classification; render(messages); });
queue.addEventListener('click', async (event) => {
  const contextButton = event.target.closest('button[data-enrich-id]');
  if (contextButton) {
    contextButton.disabled = true;
    const response = await fetch(`/api/messages/${contextButton.dataset.enrichId}/context`, { method: 'POST' });
    if (response.ok) { await load(); await loadObservability(); notify('Context refreshed'); }
    contextButton.disabled = false;
    return;
  }
  const button = event.target.closest('button[data-decision]');
  if (!button) return;
  const response = await fetch(`/api/messages/${button.dataset.id}/decision`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ decision: button.dataset.decision }) });
  if (response.ok) { await load(); notify('Decision recorded'); }
});
refreshButton.addEventListener('click', async () => { refreshButton.disabled = true; try { await load(); await loadObservability(); notify('Queue refreshed'); } catch { notify('Unable to refresh messages'); } finally { refreshButton.disabled = false; } });
observabilityRefreshButton.addEventListener('click', async () => { observabilityRefreshButton.disabled = true; try { await loadObservability(); notify('Observability refreshed'); } catch { notify('Unable to refresh observability'); } finally { observabilityRefreshButton.disabled = false; } });
syncButton.addEventListener('click', async () => { syncButton.disabled = true; const response = await fetch('/api/slack/sync', { method:'POST' }); syncButton.disabled = false; if (!response.ok) { notify('Add Slack token and channel ID first'); return; } await load(); await loadObservability(); notify('Slack messages synced'); });
async function searchMemory() {
  const query = memoryQuery.value.trim();
  if (!query) { memoryStatus.textContent = 'Enter a question to search decision memory.'; memoryResults.innerHTML = ''; return; }
  memorySearchButton.disabled = true;
  memoryStatus.textContent = 'Searching decision memory…';
  try {
    const response = await fetch(`/api/decision-memory/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error();
    renderMemorySearch(await response.json());
  } catch { memoryStatus.textContent = 'Unable to search decision memory.'; memoryResults.innerHTML = ''; }
  finally { memorySearchButton.disabled = false; }
}
memorySearchButton.addEventListener('click', searchMemory);
memoryQuery.addEventListener('keydown', (event) => { if (event.key === 'Enter') searchMemory(); });
memorySyncButton.addEventListener('click', async () => {
  memorySyncButton.disabled = true;
  memoryStatus.textContent = 'Syncing saved decisions to Mem0…';
  try {
    const response = await fetch('/api/decision-memory/sync', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error();
    memoryStatus.textContent = result.status === 'disabled'
      ? 'Mem0 is not enabled. Add MEM0_API_KEY and set MEM0_ENABLED=true.'
      : `Mem0 sync complete · ${result.synced} decision${result.synced === 1 ? '' : 's'} synced`;
    notify(result.status === 'disabled' ? 'Mem0 is not enabled' : 'Decision memory synced');
  } catch { memoryStatus.textContent = 'Unable to sync decision memory.'; notify('Mem0 sync failed'); }
  finally { memorySyncButton.disabled = false; }
});
load().catch(() => { document.querySelector('#service-status').textContent = 'Connector unavailable'; });
loadObservability().catch(() => { observabilityLangsmithStatus.textContent = 'Observability unavailable'; observabilityLangsmithStatus.className = 'status-pill inactive'; });

const queue = document.querySelector('#queue');
const toast = document.querySelector('#toast');
const syncButton = document.querySelector('#sync-button');
const refreshButton = document.querySelector('#refresh-button');
const labels = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' })[c]); }
function notify(message) { toast.textContent = message; toast.classList.add('visible'); setTimeout(() => toast.classList.remove('visible'), 2200); }
function render(messages) {
  const pending = messages.filter((m) => !m.decision);
  document.querySelector('#total-count').textContent = messages.length;
  document.querySelector('#pending-count').textContent = pending.length;
  document.querySelector('#high-count').textContent = pending.filter((m) => m.priority === 'high').length;
  queue.innerHTML = messages.map((message) => {
    const actions = message.decision ? `<span class="decision">${escapeHtml(message.decision)}</span>` : `<div class="actions"><button data-id="${message.id}" data-decision="approved">Take action</button><button data-id="${message.id}" data-decision="deferred">Defer</button><button data-id="${message.id}" data-decision="dismissed">Dismiss</button></div>`;
    return `<article class="message ${message.priority} ${message.decision ? 'done' : ''}"><div class="message-head"><span class="priority">${labels[message.priority]}</span><span class="score">${message.score}/100 signal</span></div><p class="message-text">${escapeHtml(message.text)}</p><div class="metadata"><span>${escapeHtml(message.channel)}</span><span>from ${escapeHtml(message.sender)}</span><span>${new Date(message.created_at).toLocaleString()}</span></div><p class="reason">${escapeHtml(message.reason)}</p><div class="message-footer"><span class="suggestion">${escapeHtml(message.suggested_action)}</span>${actions}</div></article>`;
  }).join('');
}
async function load() { const response = await fetch('/api/messages'); if (!response.ok) throw new Error(); render((await response.json()).messages); }
queue.addEventListener('click', async (event) => { const button = event.target.closest('button[data-decision]'); if (!button) return; const response = await fetch(`/api/messages/${button.dataset.id}/decision`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ decision: button.dataset.decision }) }); if (response.ok) { await load(); notify('Decision recorded'); } });
document.querySelector('#demo-button').addEventListener('click', async () => { const response = await fetch('/api/messages', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:'Please investigate the Slack integration before 5 PM today.'}) }); if (response.ok) { await load(); notify('Test message ranked'); } });
refreshButton.addEventListener('click', async () => { refreshButton.disabled = true; try { await load(); notify('Queue refreshed'); } catch { notify('Unable to refresh messages'); } finally { refreshButton.disabled = false; } });
syncButton.addEventListener('click', async () => { syncButton.disabled = true; const response = await fetch('/api/slack/sync', { method:'POST' }); syncButton.disabled = false; if (!response.ok) { notify('Add Slack token and channel ID first'); return; } await load(); notify('Slack messages synced'); });
load().catch(() => { document.querySelector('#service-status').textContent = 'Connector unavailable'; });

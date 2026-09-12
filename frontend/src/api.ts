import type { Message, MemoryResult, Observability, ReviewDecision, SystemStatus } from './types';
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}). Please try again.`);
  return data as T;
}
export const api = {
  messages: () => request<{ messages: Message[] }>('/api/messages'),
  system: () => request<SystemStatus>('/api/system/status'),
  observability: () => request<Observability>('/api/observability/summary'),
  review: (id: string, decision: ReviewDecision | 'pending') =>
    request<Message>(`/api/messages/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  enrich: (id: string) =>
    request<Message>(`/api/messages/${encodeURIComponent(id)}/context`, { method: 'POST' }),
  sync: () =>
    request<{ ok: boolean; status: string; ingested: number }>('/api/slack/sync', { method: 'POST' }),
  memory: (query: string) =>
    request<MemoryResult>(`/api/decision-memory/search?q=${encodeURIComponent(query)}`),
  syncMemory: () =>
    request<{ status: string; synced?: number; failed?: number }>('/api/decision-memory/sync', {
      method: 'POST',
    }),
};

import type { Message, MemoryResult, Observability, ReviewDecision, SystemStatus } from './types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '');
const MESSAGE_CACHE_KEY = 'zb-messages-cache-v1';

export type MessagesResponse = {
  messages: Message[];
  cachedAt?: string;
  fromCache?: boolean;
};

export function readCachedMessages(): MessagesResponse | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(MESSAGE_CACHE_KEY);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as Partial<MessagesResponse>;
    if (!Array.isArray(cached.messages)) return undefined;
    return {
      messages: cached.messages as Message[],
      cachedAt: typeof cached.cachedAt === 'string' ? cached.cachedAt : undefined,
      fromCache: true,
    };
  } catch {
    return undefined;
  }
}

function cacheMessages(messages: Message[]): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const cachedAt = new Date().toISOString();
  try {
    window.localStorage.setItem(MESSAGE_CACHE_KEY, JSON.stringify({ messages, cachedAt }));
    return cachedAt;
  } catch {
    return undefined;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (API_BASE_URL.includes('ngrok')) headers.set('ngrok-skip-browser-warning', '1');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}). Please try again.`);
  return data as T;
}
export const api = {
  messages: async (): Promise<MessagesResponse> => {
    try {
      const response = await request<{ messages: Message[] }>('/api/messages');
      return { ...response, cachedAt: cacheMessages(response.messages), fromCache: false };
    } catch (error) {
      const cached = readCachedMessages();
      if (cached) return cached;
      throw error;
    }
  },
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

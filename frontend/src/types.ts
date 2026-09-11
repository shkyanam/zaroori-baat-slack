export const classifications = [
  'FYI',
  'Action Required',
  'Question',
  'Incident',
  'Escalation',
  'Approval Request',
  'Decision Needed',
] as const;
export type Classification = (typeof classifications)[number];
export type ReviewDecision = 'approved' | 'dismissed' | 'deferred' | 'escalated';
export interface ExtractedItem {
  type: string;
  title: string;
  owner?: string | null;
  due?: string | null;
  source?: string;
  confidence?: string;
  source_message_ids?: string[];
}
export interface DecisionItem {
  decision: string;
  alternatives_considered?: string[];
  participants?: string[];
  date?: string;
  rationale?: string;
  source?: string;
  confidence?: string;
  source_message_ids?: string[];
}
export interface Message {
  id: string;
  text: string;
  sender: string;
  channel: string;
  created_at: string;
  decided_at?: string | null;
  priority: 'high' | 'medium' | 'low';
  classification: Classification;
  score: number;
  reason: string;
  summary?: string;
  suggested_action: string;
  decision?: ReviewDecision | null;
  thread_ts?: string;
  permalink?: string;
  context: {
    agent?: string;
    status?: string;
    briefing?: string;
    summary?: string;
    confidence?: string;
    suggested_response?: string;
    key_facts?: string[];
    open_questions?: string[];
    sources?: { name: string; detail: string }[];
    related_messages?: {
      id: string;
      text: string;
      sender: string;
      channel: string;
      relationship?: string;
    }[];
  };
  action_extraction: { agent?: string; status?: string; items?: ExtractedItem[] };
  decision_memory: { agent?: string; status?: string; items?: DecisionItem[] };
}
export interface SystemStatus {
  slack: { configured: boolean; channel_count: number; last_sync_at: string | null };
  context: { enabled: boolean; external_sources: string };
  memory: { active?: boolean; enabled?: boolean; configured?: boolean };
  workflow: { engine?: string; checkpointer?: string };
  demo: boolean;
}
export interface MemoryResult {
  provider: string;
  answer?: string;
  mem0?: { active?: boolean };
  matches: {
    id?: string;
    memory: string;
    score?: number | null;
    created_at?: string;
    metadata?: Record<string, unknown>;
  }[];
}
export interface Observability {
  metrics: {
    total_runs?: number;
    completed_runs?: number;
    failed_runs?: number;
    average_duration_ms?: number;
    classifications?: Record<string, number>;
  };
  recent_runs: {
    run_id: string;
    channel?: string;
    classification?: string;
    status: string;
    duration_ms?: number;
    started_at?: string;
    error?: string;
  }[];
  langsmith?: { active?: boolean; project?: string };
  workflow?: { checkpointer?: string };
}

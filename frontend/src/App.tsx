import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  AudioLines,
  BookOpen,
  CheckCheck,
  CircleHelp,
  Clock3,
  Hash,
  Inbox as InboxIcon,
  ListTodo,
  Menu,
  RefreshCw,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from './api';
import Inbox from './pages/Inbox';
import ActionItems from './pages/ActionItems';
import Memory from './pages/Memory';
import System from './pages/System';
import SlackMark from './components/SlackMark';
import StatusPill from './components/StatusPill';
import { channelOptions } from './slackIdentity';

export default function App() {
  const client = useQueryClient();
  const location = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState('');
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => {
    try {
      return localStorage.getItem('zb-density') === 'compact' ? 'compact' : 'comfortable';
    } catch {
      return 'comfortable';
    }
  });
  const messages = useQuery({
    queryKey: ['messages'],
    queryFn: api.messages,
    refetchInterval: __LIVE_PREVIEW__ ? 15_000 : false,
    refetchOnWindowFocus: __LIVE_PREVIEW__,
  });
  const system = useQuery({
    queryKey: ['system'],
    queryFn: api.system,
    refetchInterval: __LIVE_PREVIEW__ ? 30_000 : false,
    refetchOnWindowFocus: __LIVE_PREVIEW__,
  });
  const allMessages = messages.data?.messages ?? [];
  const pending = allMessages.filter((m) => !m.decision).length;
  const notify = (text: string) => setToast(text);
  const sync = useMutation({
    mutationFn: api.sync,
    onSuccess: (result) => {
      notify(
        result.status === 'already_running'
          ? 'Sync already in progress'
          : 'Sync started · messages will appear as they finish processing',
      );
      void client.invalidateQueries({ queryKey: ['messages'] });
      void client.invalidateQueries({ queryKey: ['system'] });
      void client.invalidateQueries({ queryKey: ['observability'] });
    },
    onError: (error) =>
      notify(
        !system.data?.slack.configured
          ? 'Slack is not configured yet. Your local demo is ready to explore.'
          : error.message,
      ),
  });
  useEffect(() => {
    if (!['running', 'processing'].includes(system.data?.slack.sync?.status || '')) return undefined;
    const timer = window.setInterval(() => {
      void client.invalidateQueries({ queryKey: ['messages'] });
      void client.invalidateQueries({ queryKey: ['system'] });
      void client.invalidateQueries({ queryKey: ['observability'] });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [client, system.data?.slack.sync?.status]);
  useEffect(() => setMobileNav(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const updateDensity = (value: 'comfortable' | 'compact') => {
    setDensity(value);
    try {
      localStorage.setItem('zb-density', value);
    } catch {
      /* Keep session preference. */
    }
  };
  const navItems = [
    { to: '/inbox', icon: InboxIcon, label: 'Inbox', count: pending },
    { to: '/actions', icon: ListTodo, label: 'Action items' },
    { to: '/memory', icon: BookOpen, label: 'Decision memory' },
    { to: '/reviewed', icon: CheckCheck, label: 'Reviewed' },
  ];
  const channels = channelOptions(allMessages);
  const selectedChannel = new URLSearchParams(location.search).get('channel');
  const lastSync = system.data?.slack.last_sync_at;
  const syncDate = lastSync ? new Date(lastSync) : undefined;
  const hasSyncDate = syncDate && !Number.isNaN(syncDate.getTime());
  const connectionText = system.isError
    ? 'Status unavailable'
    : hasSyncDate
      ? `Last synced ${syncDate.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
      : system.data?.slack.configured
        ? 'Ready to sync'
        : system.data?.demo
          ? 'Demo messages'
          : system.isPending
            ? 'Checking Slack status'
            : 'Slack not configured';
  const connection = (
    <div className="workspace-connection">
      <span className={`connection-label ${hasSyncDate && !system.isError ? 'has-sync' : ''}`}>
        <StatusPill icon={Clock3} tone={system.isError ? 'warning' : 'neutral'} surface="dark">
          {connectionText}
        </StatusPill>
      </span>
      <span>Messages from your Slack channels</span>
    </div>
  );
  const navigation = (
    <nav aria-label="Main navigation" className="primary-nav">
      {navItems.map(({ to, icon: Icon, label, count }) => (
        <NavLink
          key={to}
          to={to}
          onClick={() => setMobileNav(false)}
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <Icon size={17} />
          <span>{label}</span>
          {count !== undefined && <span className="nav-count">{count}</span>}
        </NavLink>
      ))}
    </nav>
  );
  const channelNavigation = (
    <nav aria-label="Slack channels" className="channel-nav">
      <div className="sidebar-label">
        <span>Slack channels</span>
        <span>{channels.length}</span>
      </div>
      {channels.length ? (
        channels.map((channel) => {
          const selected = location.pathname === '/inbox' && selectedChannel === channel.value;
          return (
            <NavLink
              key={channel.value}
              to={`/inbox?${new URLSearchParams({ view: 'all', channel: channel.value })}`}
              className={`channel-link ${selected ? 'selected' : ''}`}
              aria-label={`View #${channel.label} Slack messages`}
              aria-current={selected ? 'page' : false}
              title={`#${channel.label}`}
              onClick={() => setMobileNav(false)}
            >
              <Hash size={16} aria-hidden="true" />
              <span>{channel.label}</span>
            </NavLink>
          );
        })
      ) : (
        <p className="channel-empty">
          {messages.isPending
            ? 'Loading channels…'
            : 'Your channels will appear here after a sync.'}
        </p>
      )}
    </nav>
  );
  return (
    <div className={`app-shell density-${density}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/inbox" className="brand" aria-label="Zaroori Baat home">
          <span className="brand-mark">
            <AudioLines size={24} />
          </span>
          <span>
            zaroori<span className="brand-light">baat</span>
            <i />
          </span>
        </NavLink>
        <div className="workspace-source">
          <SlackMark size={20} />
          <span>Slack conversations</span>
          <span className="workspace-tagline">Your attention, well spent.</span>
        </div>
        <div className="topbar-tools">
          <button
            className="icon-button sync-button"
            aria-label="Sync Slack"
            title="Sync Slack"
            disabled={
              sync.isPending ||
              ['running', 'processing'].includes(system.data?.slack.sync?.status || '')
            }
            onClick={() => sync.mutate()}
          >
            <RefreshCw
              size={17}
              className={
                sync.isPending ||
                ['running', 'processing'].includes(system.data?.slack.sync?.status || '')
                  ? 'spinning'
                  : ''
              }
            />
            <span>
              {sync.isPending ||
              ['running', 'processing'].includes(system.data?.slack.sync?.status || '')
                ? 'Syncing…'
                : 'Sync Slack'}
            </span>
          </button>
          <span className="topbar-avatar" title="Mitesh · local workspace">
            M
          </span>
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={22} />
          </button>
        </div>
      </header>
      <aside className="workspace-sidebar" aria-label="Workspace sidebar">
        <div className="workspace-heading">
          <span className="workspace-logo">
            <SlackMark size={25} />
          </span>
          <div>
            <strong>Slack workspace</strong>
            <span>Only the conversations that matter</span>
          </div>
        </div>
        <p className="sidebar-label">Your workspace</p>
        {navigation}
        {channelNavigation}
        <div className="sidebar-bottom">
          <NavLink
            to="/system"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Settings2 size={17} aria-hidden="true" />
            System
          </NavLink>
          {connection}
        </div>
      </aside>
      <Dialog.Root open={mobileNav} onOpenChange={setMobileNav}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="mobile-navigation">
            <Dialog.Title>
              <SlackMark size={23} /> Slack workspace
            </Dialog.Title>
            <Dialog.Description className="sr-only">Choose where to go.</Dialog.Description>
            {navigation}
            {channelNavigation}
            <NavLink to="/system" className="nav-link" onClick={() => setMobileNav(false)}>
              <Settings2 size={18} />
              System
            </NavLink>
            {connection}
            <Dialog.Close className="dialog-close" aria-label="Close navigation">
              <X size={20} />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <main id="main-content" tabIndex={-1}>
        {messages.isError && (
          <div className="error-banner" role="alert">
            <span>We couldn’t load your messages. {messages.error.message}</span>
            <button className="btn" onClick={() => void messages.refetch()}>
              Retry
            </button>
          </div>
        )}
        <Routes>
          <Route
            path="/inbox"
            element={
              <Inbox
                messages={allMessages}
                loading={messages.isPending}
                failed={messages.isError}
                fetching={messages.isFetching}
                notify={notify}
              />
            }
          />
          <Route
            path="/reviewed"
            element={
              <Inbox
                messages={allMessages}
                loading={messages.isPending}
                failed={messages.isError}
                fetching={messages.isFetching}
                reviewed
                notify={notify}
              />
            }
          />
          <Route
            path="/actions"
            element={
              <ActionItems
                messages={allMessages}
                loading={messages.isPending}
                failed={messages.isError}
              />
            }
          />
          <Route
            path="/memory"
            element={
              <Memory
                messages={allMessages}
                loading={messages.isPending}
                failed={messages.isError}
              />
            }
          />
          <Route
            path="/system"
            element={<System density={density} onDensityChange={updateDensity} />}
          />
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Routes>
      </main>
      <footer className="app-footer">
        <span>
          <span className="footer-signal">
            <i />
            <i />
            <i />
          </span>
          Your Slack. A little more headspace.
        </span>
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button className="footer-help">
              <CircleHelp size={15} />
              How it works
              <ArrowUpRight size={12} />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="help-dialog">
              <Dialog.Title>A little more headspace.</Dialog.Title>
              <Dialog.Description>
                Important conversations, one clear next step at a time.
              </Dialog.Description>
              <div className="help-steps">
                <div>
                  <span>
                    <Sparkles size={20} />
                  </span>
                  <strong>Understand</strong>
                  <p>The important bits first. The full conversation when you need it.</p>
                </div>
                <div>
                  <span>
                    <BookOpen size={20} />
                  </span>
                  <strong>Prepare</strong>
                  <p>Shape a response with context already beside you.</p>
                </div>
                <div>
                  <span>
                    <CheckCheck size={20} />
                  </span>
                  <strong>Decide</strong>
                  <p>Approve, set aside, or dismiss. Then move to the next conversation.</p>
                </div>
              </div>
              <p className="muted">
                Reviews are saved locally. Replies are copied and sent by you. External work, build,
                and incident findings use sample sources.
              </p>
              <Dialog.Close asChild>
                <button className="btn primary">Got it</button>
              </Dialog.Close>
              <Dialog.Close className="dialog-close" aria-label="Close help">
                <X size={20} />
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

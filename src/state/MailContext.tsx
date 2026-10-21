import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { registerBackgroundSync } from '../background/task';
import { STRINGS, type CopyKey } from '../i18n/strings';
import { createDemoState } from '../mail/demo';
import {
  deleteLabel,
  deleteRule,
  deleteTemplate,
  normalizeState,
  removeAccount,
  sanitizeMailbox,
  saveLabel,
  saveRule,
  saveSettings,
  saveSignature,
  saveTemplate,
  setMessageFlags,
  upsertAccount,
} from '../mail/mailbox';
import { queuePending } from '../mail/merge';
import type { Account, FilterRule, Label, Locale, MailboxState, MailMessage, OutgoingMail, Signature, Template } from '../mail/types';
import { ACCOUNT_COLORS, createId } from '../mail/types';
import { selectMessages, unreadInboxCount, type BoxFilter } from '../mail/view';
import { kv } from '../platform/kv';
import { secrets } from '../platform/secrets';
import {
  deliver,
  forgetAccountSecrets,
  probeImap,
  rememberGmail,
  rememberImapPassword,
  registerRelay,
  searchRemote,
  syncAll,
  withMailboxLock,
  type ImapDraft,
} from '../sync/engine';
import type { GmailTokens } from '../mail/gmail/api';

interface MailApi {
  ready: boolean;
  state: MailboxState;
  syncing: boolean;
  banner: string;
  clearBanner: () => void;
  box: BoxFilter;
  setBox: (box: BoxFilter) => void;
  messages: MailMessage[];
  unreadCount: number;
  t: (key: CopyKey) => string;
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  refresh: () => Promise<void>;
  markRead: (id: string, read: boolean) => Promise<void>;
  setFlag: (id: string, flagged: boolean) => Promise<void>;
  setColor: (id: string, color?: string) => Promise<void>;
  toggleLabel: (id: string, labelId: string) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  saveImap: (draft: ImapDraft) => Promise<void>;
  saveGmail: (email: string, displayName: string, tokens: GmailTokens) => Promise<void>;
  probe: (draft: ImapDraft) => Promise<void>;
  saveRule: (rule: FilterRule) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  saveTemplate: (template: Template) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  saveLabel: (label: Label) => Promise<void>;
  deleteLabel: (id: string) => Promise<void>;
  saveSignature: (accountId: string, signature: Signature) => Promise<void>;
  saveRelay: (url: string, secret: string) => Promise<void>;
  setBackground: (enabled: boolean) => Promise<void>;
  send: (accountId: string, mail: OutgoingMail) => Promise<void>;
  searchOnServer: (query: string) => Promise<void>;
}

const MailContext = createContext<MailApi | null>(null);

export function MailProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MailboxState>(createDemoState());
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState('');
  const [box, setBox] = useState<BoxFilter>({ kind: 'inbox' });
  const ref = useRef(state);
  ref.current = state;

  const commit = useCallback(async (mutate: (current: MailboxState) => MailboxState) => {
    await withMailboxLock(async () => {
      const next = sanitizeMailbox(mutate(ref.current));
      ref.current = next;
      setState(next);
      await kv.save(next);
    });
  }, []);

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      await withMailboxLock(async () => {
        const notify = AppState.currentState !== 'active';
        const outcome = await syncAll(ref.current, notify);
        ref.current = outcome.state;
        setState(outcome.state);
        await kv.save(outcome.state);
        if (outcome.note && outcome.freshCount === 0 && outcome.note.includes('@')) setBanner(outcome.note);
        else if (outcome.freshCount > 0) setBanner(`${STRINGS[outcome.state.settings.locale].freshMail}: ${outcome.freshCount}`);
        else if (!outcome.note) setBanner('');
      });
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void withMailboxLock(async () => {
      const existing = await kv.load();
      const loaded = normalizeState(existing) ?? createDemoState();
      if (!existing) await kv.save(loaded);
      if (!alive) return;
      ref.current = loaded;
      setState(loaded);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 3 * 60 * 1000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    if (state.settings.backgroundSyncEnabled) void registerBackgroundSync().catch(() => undefined);
    return () => {
      clearInterval(timer);
      sub.remove();
    };
    // Refresh once when the mailbox is ready. Later edits should not restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const locale = state.settings.locale;
  const t = useCallback((key: CopyKey) => STRINGS[locale][key], [locale]);
  const messages = useMemo(() => selectMessages(state, box), [state, box]);

  const api = useMemo<MailApi>(() => ({
    ready,
    state,
    syncing,
    banner,
    clearBanner: () => setBanner(''),
    box,
    setBox,
    messages,
    unreadCount: unreadInboxCount(state),
    t,
    locale,
    setLocale: (next) => commit((current) => saveSettings(current, { ...current.settings, locale: next })),
    refresh,
    markRead: (id, read) => commit((current) => patchFlag(current, id, { unread: !read }, read ? 'read' : 'unread')),
    setFlag: (id, flagged) => commit((current) => patchFlag(current, id, { flagged }, flagged ? 'flag' : 'unflag')),
    setColor: (id, color) => commit((current) => setMessageFlags(current, id, { color })),
    toggleLabel: (id, labelId) => commit((current) => {
      const message = current.messages.find((item) => item.id === id);
      if (!message) return current;
      const labelIds = message.labelIds.includes(labelId)
        ? message.labelIds.filter((item) => item !== labelId)
        : [...message.labelIds, labelId];
      return setMessageFlags(current, id, { labelIds });
    }),
    deleteAccount: async (id) => {
      await forgetAccountSecrets(id);
      await commit((current) => removeAccount(current, id));
    },
    saveImap: async (draft) => {
      const email = draft.email.trim().toLowerCase();
      if (ref.current.accounts.some((account) => account.email.toLowerCase() === email)) {
        throw new Error(STRINGS[ref.current.settings.locale].accountExists);
      }
      const id = createId('acc');
      await rememberImapPassword(id, draft.password);
      const account: Account = {
        id,
        kind: 'imap',
        email,
        displayName: draft.displayName.trim() || email,
        color: ACCOUNT_COLORS[ref.current.accounts.length % ACCOUNT_COLORS.length] ?? '#C45C38',
        createdAt: Date.now(),
        imap: {
          username: draft.username.trim() || email,
          imapHost: draft.imapHost.trim(),
          imapPort: draft.imapPort,
          imapTls: draft.imapTls,
          smtpHost: draft.smtpHost.trim(),
          smtpPort: draft.smtpPort,
          smtpTls: draft.smtpTls,
        },
      };
      await commit((current) => upsertAccount(current, account));
    },
    saveGmail: async (email, displayName, tokens) => {
      const normalized = email.trim().toLowerCase();
      if (ref.current.accounts.some((account) => account.email.toLowerCase() === normalized)) {
        throw new Error(STRINGS[ref.current.settings.locale].accountExists);
      }
      const id = createId('acc');
      await rememberGmail(id, tokens);
      const account: Account = {
        id,
        kind: 'gmail',
        email: normalized,
        displayName: displayName.trim() || normalized,
        color: ACCOUNT_COLORS[ref.current.accounts.length % ACCOUNT_COLORS.length] ?? '#C45C38',
        createdAt: Date.now(),
      };
      await commit((current) => upsertAccount(current, account));
    },
    probe: probeImap,
    saveRule: (rule) => commit((current) => saveRule(current, rule)),
    deleteRule: (id) => commit((current) => deleteRule(current, id)),
    saveTemplate: (template) => commit((current) => saveTemplate(current, template)),
    deleteTemplate: (id) => commit((current) => deleteTemplate(current, id)),
    saveLabel: (label) => commit((current) => saveLabel(current, label)),
    deleteLabel: (id) => commit((current) => deleteLabel(current, id)),
    saveSignature: (accountId, signature) => commit((current) => saveSignature(current, accountId, signature)),
    saveRelay: async (url, secret) => {
      if (secret.trim()) await secrets.set('relay', secret.trim());
      await commit((current) => saveSettings(current, { ...current.settings, relayUrl: url.trim() }));
      await registerRelay(url);
    },
    setBackground: async (enabled) => {
      await commit((current) => saveSettings(current, { ...current.settings, backgroundSyncEnabled: enabled }));
      if (enabled && Platform.OS !== 'web') await registerBackgroundSync().catch(() => undefined);
    },
    send: async (accountId, mail) => {
      const account = ref.current.accounts.find((item) => item.id === accountId);
      if (!account) throw new Error(STRINGS[ref.current.settings.locale].needRealAccount);
      await withMailboxLock(async () => {
        const next = await deliver(ref.current, account, mail);
        ref.current = next;
        setState(next);
        await kv.save(next);
      });
    },
    searchOnServer: async (query) => {
      setSyncing(true);
      try {
        await withMailboxLock(async () => {
          const next = await searchRemote(ref.current, query);
          ref.current = next;
          setState(next);
          await kv.save(next);
        });
      } finally {
        setSyncing(false);
      }
    },
  }), [ready, state, syncing, banner, box, messages, t, locale, commit, refresh]);

  return <MailContext.Provider value={api}>{children}</MailContext.Provider>;
}

function patchFlag(state: MailboxState, id: string, patch: Partial<Pick<MailMessage, 'unread' | 'flagged'>>, op: 'read' | 'unread' | 'flag' | 'unflag'): MailboxState {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return state;
  let next = setMessageFlags(state, id, patch);
  const account = state.accounts.find((item) => item.id === message.accountId);
  if (account && account.kind !== 'demo') next = queuePending(next, message, op);
  return next;
}

export function useMail(): MailApi {
  const value = useContext(MailContext);
  if (!value) throw new Error('MailProvider missing');
  return value;
}

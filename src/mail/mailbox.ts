import { assertNoSecrets } from './redact';
import type { Account, AppSettings, FilterRule, Label, MailboxState, MailMessage, Signature, Template } from './types';

export function emptySettings(): AppSettings {
  return { locale: 'ru', backgroundSyncEnabled: true, relayUrl: '' };
}

export function normalizeState(raw: Partial<MailboxState> | null | undefined): MailboxState | null {
  if (!raw || !Array.isArray(raw.accounts)) return null;
  return {
    accounts: raw.accounts,
    messages: raw.messages ?? [],
    labels: raw.labels ?? [],
    rules: raw.rules ?? [],
    templates: raw.templates ?? [],
    signatures: raw.signatures ?? {},
    settings: { ...emptySettings(), ...raw.settings },
    pending: raw.pending ?? [],
  };
}

export function sanitizeMailbox(state: MailboxState): MailboxState {
  assertNoSecrets(state);
  return state;
}

export function upsertAccount(state: MailboxState, account: Account): MailboxState {
  const accounts = state.accounts.some((item) => item.id === account.id)
    ? state.accounts.map((item) => (item.id === account.id ? account : item))
    : [...state.accounts, account];
  return sanitizeMailbox({ ...state, accounts });
}

export function removeAccount(state: MailboxState, accountId: string): MailboxState {
  const { [accountId]: _removed, ...signatures } = state.signatures;
  return sanitizeMailbox({
    ...state,
    accounts: state.accounts.filter((item) => item.id !== accountId),
    messages: state.messages.filter((item) => item.accountId !== accountId),
    pending: state.pending.filter((item) => item.accountId !== accountId),
    signatures,
  });
}

export function setMessageFlags(state: MailboxState, id: string, patch: Partial<Pick<MailMessage, 'unread' | 'flagged' | 'color' | 'labelIds'>>): MailboxState {
  return {
    ...state,
    messages: state.messages.map((message) => (message.id === id ? { ...message, ...patch } : message)),
  };
}

export function saveRule(state: MailboxState, rule: FilterRule): MailboxState {
  const rules = state.rules.some((item) => item.id === rule.id)
    ? state.rules.map((item) => (item.id === rule.id ? rule : item))
    : [...state.rules, rule];
  return { ...state, rules };
}

export function deleteRule(state: MailboxState, id: string): MailboxState {
  return { ...state, rules: state.rules.filter((item) => item.id !== id) };
}

export function saveTemplate(state: MailboxState, template: Template): MailboxState {
  const templates = state.templates.some((item) => item.id === template.id)
    ? state.templates.map((item) => (item.id === template.id ? template : item))
    : [...state.templates, template];
  return { ...state, templates };
}

export function deleteTemplate(state: MailboxState, id: string): MailboxState {
  return { ...state, templates: state.templates.filter((item) => item.id !== id) };
}

export function saveLabel(state: MailboxState, label: Label): MailboxState {
  const labels = state.labels.some((item) => item.id === label.id)
    ? state.labels.map((item) => (item.id === label.id ? label : item))
    : [...state.labels, label];
  return { ...state, labels };
}

export function deleteLabel(state: MailboxState, id: string): MailboxState {
  return {
    ...state,
    labels: state.labels.filter((item) => item.id !== id),
    messages: state.messages.map((message) => ({ ...message, labelIds: message.labelIds.filter((labelId) => labelId !== id) })),
  };
}

export function saveSignature(state: MailboxState, accountId: string, signature: Signature): MailboxState {
  return { ...state, signatures: { ...state.signatures, [accountId]: signature } };
}

export function saveSettings(state: MailboxState, settings: AppSettings): MailboxState {
  return sanitizeMailbox({ ...state, settings });
}

export function addLocalSent(state: MailboxState, message: MailMessage): MailboxState {
  return { ...state, messages: [message, ...state.messages] };
}

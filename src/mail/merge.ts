import { applyFilterRules, messageFilterInput } from './filters';
import type { Account, FilterResult, MailboxState, MailMessage, PendingOp, PendingOpName, PulledMessage } from './types';
import { createId, localMessageId } from './types';

export interface MergeReport {
  state: MailboxState;
  fresh: MailMessage[];
  remoteReads: { accountId: string; folder: string; remoteId: string }[];
  remoteFlags: { accountId: string; folder: string; remoteId: string }[];
}

export function mergePulled(state: MailboxState, account: Account, pulled: PulledMessage[]): MergeReport {
  const messages = [...state.messages];
  const fresh: MailMessage[] = [];
  const remoteReads: MergeReport['remoteReads'] = [];
  const remoteFlags: MergeReport['remoteFlags'] = [];

  for (const item of pulled) {
    const id = localMessageId(account.id, item.folder, item.remoteId);
    const index = messages.findIndex((message) => message.id === id);
    const base = index >= 0 ? messages[index] : undefined;
    const draft = toMessage(account.id, item, base);
    const outcome = applyFilterRules(messageFilterInput(draft, account.email), state.rules, {
      unread: draft.unread,
      flagged: draft.flagged,
      labelIds: base?.labelIds ?? [],
      color: base?.color,
    });
    let next = applyOutcome(draft, outcome);
    next = reapplyPending(next, state.pending);
    if (outcome.remoteMarkRead) remoteReads.push({ accountId: account.id, folder: item.folder, remoteId: item.remoteId });
    if (outcome.remoteFlag) remoteFlags.push({ accountId: account.id, folder: item.folder, remoteId: item.remoteId });
    if (index >= 0) messages[index] = next;
    else {
      messages.push(next);
      fresh.push(next);
    }
  }

  return { state: { ...state, messages }, fresh, remoteReads, remoteFlags };
}

export function reapplyPending(message: MailMessage, pending: PendingOp[]): MailMessage {
  let next = message;
  for (const op of pending) {
    if (op.accountId !== message.accountId || op.remoteId !== message.remoteId || op.folder !== message.folder) continue;
    if (op.op === 'read') next = { ...next, unread: false };
    if (op.op === 'unread') next = { ...next, unread: true };
    if (op.op === 'flag') next = { ...next, flagged: true };
    if (op.op === 'unflag') next = { ...next, flagged: false };
  }
  return next;
}

function applyOutcome(message: MailMessage, outcome: FilterResult): MailMessage {
  return {
    ...message,
    unread: outcome.unread,
    flagged: outcome.flagged,
    labelIds: outcome.labelIds,
    color: outcome.color ?? message.color,
  };
}

function toMessage(accountId: string, item: PulledMessage, previous: MailMessage | undefined): MailMessage {
  return {
    id: localMessageId(accountId, item.folder, item.remoteId),
    accountId,
    remoteId: item.remoteId,
    folder: item.folder,
    from: item.from,
    to: item.to,
    cc: item.cc,
    bcc: [],
    subject: item.subject,
    date: item.date,
    snippet: item.snippet,
    unread: item.unread,
    flagged: item.flagged,
    hasAttachments: item.hasAttachments,
    color: previous?.color,
    labelIds: previous?.labelIds ?? [],
    messageId: item.messageId ?? previous?.messageId,
    inReplyTo: item.inReplyTo ?? previous?.inReplyTo,
    references: item.references ?? previous?.references,
    text: item.bodyLoaded ? item.text : previous?.text ?? item.text,
    html: item.bodyLoaded ? item.html : previous?.html,
    attachments: item.bodyLoaded ? item.attachments : previous?.attachments ?? item.attachments,
    bodyLoaded: item.bodyLoaded || previous?.bodyLoaded || false,
  };
}

export function queuePending(state: MailboxState, message: MailMessage, op: PendingOpName): MailboxState {
  const pending = state.pending.filter((item) => !(item.accountId === message.accountId && item.remoteId === message.remoteId && item.folder === message.folder && opposite(item.op) === op));
  const withoutSame = pending.filter((item) => !(item.accountId === message.accountId && item.remoteId === message.remoteId && item.folder === message.folder && item.op === op));
  return {
    ...state,
    pending: [...withoutSame, { id: createId('op'), accountId: message.accountId, remoteId: message.remoteId, folder: message.folder, op }],
  };
}

function opposite(op: PendingOpName): PendingOpName | undefined {
  if (op === 'read') return 'unread';
  if (op === 'unread') return 'read';
  if (op === 'flag') return 'unflag';
  if (op === 'unflag') return 'flag';
  return undefined;
}

export function dropPending(state: MailboxState, done: PendingOp[]): MailboxState {
  const ids = new Set(done.map((item) => item.id));
  return { ...state, pending: state.pending.filter((item) => !ids.has(item.id)) };
}

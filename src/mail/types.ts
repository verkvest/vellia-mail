export type Locale = 'ru' | 'es' | 'en';
export type AccountKind = 'gmail' | 'imap' | 'demo';

export interface Address {
  name: string;
  email: string;
}

export interface ImapConfig {
  username: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  sentMailbox?: string;
}

export interface Account {
  id: string;
  kind: AccountKind;
  email: string;
  displayName: string;
  color: string;
  imap?: ImapConfig;
  createdAt: number;
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentBase64?: string;
  gmailAttachmentId?: string;
}

export interface MailMessage {
  id: string;
  accountId: string;
  remoteId: string;
  folder: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  date: number;
  snippet: string;
  unread: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  color?: string;
  labelIds: string[];
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  text: string;
  html?: string;
  attachments: Attachment[];
  bodyLoaded: boolean;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export type ConditionField = 'from' | 'to' | 'cc' | 'subject' | 'account' | 'body';
export type ConditionOp = 'contains' | 'notContains' | 'equals' | 'startsWith' | 'endsWith';
export type MatchMode = 'all' | 'any';

export interface Condition {
  field: ConditionField;
  op: ConditionOp;
  value: string;
}

export type FilterAction =
  | { type: 'addLabel'; labelId: string }
  | { type: 'markRead' }
  | { type: 'flag' }
  | { type: 'unflag' }
  | { type: 'color'; color: string }
  | { type: 'stop' };

export interface FilterRule {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  match: MatchMode;
  conditions: Condition[];
  actions: FilterAction[];
}

export interface Template {
  id: string;
  title: string;
  body: string;
  order: number;
}

export interface Signature {
  body: string;
  enabled: boolean;
}

export interface AppSettings {
  locale: Locale;
  backgroundSyncEnabled: boolean;
  relayUrl: string;
  lastSyncAt?: number;
  lastSyncError?: string;
}

export type PendingOpName = 'read' | 'unread' | 'flag' | 'unflag';

export interface PendingOp {
  id: string;
  accountId: string;
  remoteId: string;
  folder: string;
  op: PendingOpName;
}

export interface MailboxState {
  accounts: Account[];
  messages: MailMessage[];
  labels: Label[];
  rules: FilterRule[];
  templates: Template[];
  signatures: Record<string, Signature>;
  settings: AppSettings;
  pending: PendingOp[];
}

export interface FilterInput {
  from: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  accountEmail: string;
}

export interface FilterSnapshot {
  unread: boolean;
  flagged: boolean;
  labelIds: string[];
  color?: string;
}

export interface FilterResult extends FilterSnapshot {
  matchedRuleIds: string[];
  remoteMarkRead: boolean;
  remoteFlag: boolean;
}

export interface PulledMessage {
  remoteId: string;
  folder: string;
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  date: number;
  snippet: string;
  unread: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  text: string;
  html?: string;
  attachments: Attachment[];
  bodyLoaded: boolean;
}

export interface OutgoingMail {
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  text: string;
  attachments: { filename: string; contentType: string; contentBase64: string }[];
  inReplyTo?: string;
  references?: string;
}

export const ACCOUNT_COLORS = ['#C45C38', '#2F5D50', '#3E5C76', '#A6844A', '#6B4C7A', '#8C4A3A'];

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function localMessageId(accountId: string, folder: string, remoteId: string): string {
  return `${accountId}:${folder}:${remoteId}`;
}

export function addressLine(addresses: Address[]): string {
  return addresses.map((item) => item.name || item.email).filter(Boolean).join(', ');
}

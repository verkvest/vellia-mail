import { parseMime } from './mime/parse';
import { makeSnippet } from './htmlText';
import { ImapClient, parseImapDate, sentMailboxName, type FetchMeta } from './imap/client';
import type { Address, PulledMessage } from './types';

const EMPTY: Address = { name: '', email: '' };

export async function pullImapFolder(client: ImapClient, folder: string, limit = 25): Promise<PulledMessage[]> {
  const selected = await client.select(folder);
  if (selected.exists === 0) return [];
  const all = await client.uidSearch('ALL');
  const uids = all.slice(-limit);
  if (!uids.length) return [];
  const meta = await client.uidFetch(uids, 'UID FLAGS INTERNALDATE RFC822.SIZE ENVELOPE');
  const small = meta.filter((item) => (item.size ?? 0) <= 500_000 && (item.size ?? 1) > 0).map((item) => item.uid);
  const bodies = small.length ? await client.uidFetch(small, 'UID BODY.PEEK[]') : [];
  const rawByUid = new Map(bodies.filter((item) => item.raw).map((item) => [item.uid, item.raw as Uint8Array]));
  return meta.map((item) => toPulled(folder, item, rawByUid.get(item.uid)));
}

export async function pullImapAccount(client: ImapClient, limit = 25): Promise<{ messages: PulledMessage[]; sentMailbox?: string }> {
  const boxes = await client.listMailboxes();
  const sent = sentMailboxName(boxes);
  const inbox = await pullImapFolder(client, 'INBOX', limit);
  const sentMessages = sent && sent.toUpperCase() !== 'INBOX' ? await pullImapFolder(client, sent, Math.min(limit, 15)) : [];
  return { messages: [...inbox, ...sentMessages], sentMailbox: sent };
}

export async function searchImap(client: ImapClient, folder: string, query: string, limit = 20): Promise<PulledMessage[]> {
  await client.select(folder);
  const safe = query.replace(/[\r\n"]/g, ' ').trim();
  if (!safe) return [];
  const uids = (await client.uidSearch(`TEXT ${JSON.stringify(safe)}`)).slice(-limit);
  if (!uids.length) return [];
  const fetched = await client.uidFetch(uids, 'UID FLAGS INTERNALDATE ENVELOPE BODY.PEEK[]');
  return fetched.map((item) => toPulled(folder, item, item.raw));
}

function toPulled(folder: string, meta: FetchMeta, raw: Uint8Array | undefined): PulledMessage {
  const parsed = raw ? parseMime(raw) : undefined;
  const from = parsed?.from.email ? parsed.from : meta.envelope?.from[0] ?? EMPTY;
  const subject = parsed?.subject || meta.envelope?.subject || '';
  const text = parsed?.text ?? '';
  const date = parseImapDate(meta.internalDate) || parsed?.date || parseImapDate(meta.envelope?.date) || Date.now();
  return {
    remoteId: String(meta.uid),
    folder,
    from,
    to: parsed?.to.length ? parsed.to : meta.envelope?.to ?? [],
    cc: parsed?.cc.length ? parsed.cc : meta.envelope?.cc ?? [],
    subject,
    date,
    snippet: parsed?.snippet || makeSnippet(text) || subject,
    unread: !meta.flags.some((flag) => flag.toLowerCase() === '\\seen'),
    flagged: meta.flags.some((flag) => flag.toLowerCase() === '\\flagged'),
    hasAttachments: (parsed?.attachments.length ?? 0) > 0,
    messageId: parsed?.messageId || meta.envelope?.messageId,
    inReplyTo: parsed?.inReplyTo || meta.envelope?.inReplyTo,
    references: parsed?.references,
    text,
    html: parsed?.html,
    attachments: parsed?.attachments ?? [],
    bodyLoaded: Boolean(raw),
  };
}

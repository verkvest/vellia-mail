import { base64ToBytes } from '../bytes';
import { decodeCharset } from '../charset';
import { decodeHeaderWords, parseAddressList } from '../header';
import { htmlToText, makeSnippet } from '../htmlText';
import type { Attachment, PulledMessage } from '../types';

export interface HttpResponse {
  status: number;
  body: string;
}

export interface HttpClient {
  request(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<HttpResponse>;
}

export interface GmailTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  clientId: string;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailApi {
  constructor(
    private http: HttpClient,
    private tokens: GmailTokens,
    private onTokens: (tokens: GmailTokens) => void,
  ) {}

  getTokens(): GmailTokens {
    return this.tokens;
  }

  async profile(): Promise<{ email: string }> {
    const json = await this.get('/profile');
    return { email: String(json.emailAddress ?? '') };
  }

  async listLabels(): Promise<{ id: string; name: string }[]> {
    const json = await this.get('/labels');
    const labels = Array.isArray(json.labels) ? json.labels : [];
    return labels.map((label) => ({ id: String(label.id), name: String(label.name) }));
  }

  async listMessageIds(query: string, max = 25): Promise<string[]> {
    const json = await this.get(`/messages?maxResults=${max}&q=${encodeURIComponent(query)}`);
    const messages = Array.isArray(json.messages) ? json.messages : [];
    return messages.map((item) => String(item.id));
  }

  async getMessage(id: string): Promise<GmailMessage> {
    return (await this.get(`/messages/${encodeURIComponent(id)}?format=full`)) as unknown as GmailMessage;
  }

  async sendRaw(rawUrl: string): Promise<{ id: string }> {
    const json = await this.send('POST', '/messages/send', JSON.stringify({ raw: rawUrl }));
    return { id: String(json.id ?? '') };
  }

  async modify(id: string, addLabelIds: string[], removeLabelIds: string[]): Promise<void> {
    await this.send(
      'POST',
      `/messages/${encodeURIComponent(id)}/modify`,
      JSON.stringify({ addLabelIds, removeLabelIds }),
    );
  }

  private async get(path: string): Promise<Record<string, any>> {
    return this.send('GET', path);
  }

  private async send(method: string, path: string, body?: string, refreshed = false): Promise<Record<string, any>> {
    await this.ensureFresh();
    const response = await this.http.request(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
    if (response.status === 401 && !refreshed) {
      await this.refresh();
      return this.send(method, path, body, true);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Gmail ${response.status}`);
    }
    if (!response.body) return {};
    return JSON.parse(response.body) as Record<string, any>;
  }

  private async ensureFresh() {
    if (Date.now() < this.tokens.expiresAt - 60_000) return;
    await this.refresh();
  }

  private async refresh() {
    if (!this.tokens.refreshToken) throw new Error('Нет ключа обновления Google. Войдите снова.');
    const body = new URLSearchParams({
      client_id: this.tokens.clientId,
      refresh_token: this.tokens.refreshToken,
      grant_type: 'refresh_token',
    });
    const response = await this.http.request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (response.status !== 200) throw new Error('Google не обновил доступ');
    const json = JSON.parse(response.body) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('Google не обновил доступ');
    this.tokens = {
      ...this.tokens,
      accessToken: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    this.onTokens(this.tokens);
  }
}

export function gmailToPulled(message: GmailMessage, folder: string): PulledMessage {
  const headers = new Map((message.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
  const from = parseAddressList(headers.get('from'))[0] ?? { name: '', email: '' };
  const collected = walk(message.payload, []);
  const text = collected.text || (collected.html ? htmlToText(collected.html) : '');
  const labels = message.labelIds ?? [];
  return {
    remoteId: message.id,
    folder,
    from,
    to: parseAddressList(headers.get('to')),
    cc: parseAddressList(headers.get('cc')),
    subject: decodeHeaderWords(headers.get('subject') ?? ''),
    date: Number(message.internalDate) || Date.parse(headers.get('date') ?? '') || Date.now(),
    snippet: message.snippet || makeSnippet(text),
    unread: labels.includes('UNREAD'),
    flagged: labels.includes('STARRED'),
    hasAttachments: collected.attachments.length > 0,
    messageId: headers.get('message-id'),
    inReplyTo: headers.get('in-reply-to'),
    references: headers.get('references'),
    text,
    html: collected.html || undefined,
    attachments: collected.attachments,
    bodyLoaded: true,
  };
}

function headerValue(part: GmailPart | undefined, name: string): string | undefined {
  return part?.headers?.find((header) => header.name.toLowerCase() === name)?.value;
}

function walk(part: GmailPart | undefined, attachments: Attachment[], depth = 0): { text: string; html: string; attachments: Attachment[] } {
  if (!part || depth > 20) return { text: '', html: '', attachments };
  const filename = part.filename || '';
  const mime = part.mimeType ?? '';
  if (filename || part.body?.attachmentId) {
    attachments.push({
      id: part.body?.attachmentId || `file_${attachments.length + 1}`,
      filename: filename || 'attachment',
      contentType: mime || 'application/octet-stream',
      size: part.body?.size ?? 0,
      gmailAttachmentId: part.body?.attachmentId,
    });
  } else if (part.body?.data && /text\/plain/i.test(mime)) {
    return { text: decodeGmailBody(part.body.data, charsetOf(part)), html: '', attachments };
  } else if (part.body?.data && /text\/html/i.test(mime)) {
    return { text: '', html: decodeGmailBody(part.body.data, charsetOf(part)), attachments };
  }
  let text = '';
  let html = '';
  for (const child of part.parts ?? []) {
    const next = walk(child, attachments, depth + 1);
    if (next.text) text = text ? `${text}\n${next.text}` : next.text;
    if (next.html) html = html ? `${html}\n${next.html}` : next.html;
  }
  return { text, html, attachments };
}

function charsetOf(part: GmailPart): string | undefined {
  const type = headerValue(part, 'content-type') ?? '';
  return /charset="?([^";]+)/i.exec(type)?.[1];
}

function decodeGmailBody(data: string, charset: string | undefined): string {
  return decodeCharset(base64ToBytes(data), charset ?? 'utf-8');
}

export async function pullGmail(api: GmailApi, folder: 'INBOX' | 'SENT', limit = 25): Promise<PulledMessage[]> {
  const query = folder === 'SENT' ? 'in:sent newer_than:30d' : 'in:inbox newer_than:30d';
  const ids = await api.listMessageIds(query, limit);
  const messages: PulledMessage[] = [];
  for (const id of ids) {
    const full = await api.getMessage(id);
    messages.push(gmailToPulled(full, folder));
  }
  return messages;
}

import type { Address } from './types';

export function replySubject(subject: string, kind: 'reply' | 'forward'): string {
  const clean = subject.trim() || '';
  if (kind === 'forward') {
    if (/^(fwd|fw|rv|пересыл)\s*:/i.test(clean)) return clean;
    return clean ? `Fwd: ${clean}` : 'Fwd:';
  }
  if (/^(re|aw|ответ)\s*:/i.test(clean)) return clean;
  return clean ? `Re: ${clean}` : 'Re:';
}

export function quoteBody(text: string, fromLabel: string): string {
  const quoted = text.trim().split(/\r?\n/).map((line) => `> ${line}`).join('\n');
  return `\n\n${fromLabel}:\n${quoted}\n`;
}

export function replyRecipients(
  message: { from: Address; to: Address[]; cc: Address[] },
  selfEmail: string,
  mode: 'reply' | 'replyAll' | 'forward',
): { to: Address[]; cc: Address[] } {
  if (mode === 'forward') return { to: [], cc: [] };
  const self = selfEmail.trim().toLowerCase();
  const isSelf = (address: Address) => address.email.trim().toLowerCase() === self;
  const pool = mode === 'replyAll' ? [message.from, ...message.to] : [message.from];
  return {
    to: uniqueAddresses(pool.filter((address) => address.email && !isSelf(address))),
    cc: mode === 'replyAll' ? uniqueAddresses(message.cc.filter((address) => address.email && !isSelf(address))) : [],
  };
}

function uniqueAddresses(addresses: Address[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const address of addresses) {
    const key = address.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

export function referenceHeader(existing: string | undefined, messageId: string | undefined): string | undefined {
  const parts = [existing, messageId].map((item) => item?.trim()).filter((item): item is string => Boolean(item));
  if (!parts.length) return undefined;
  return parts.join(' ');
}

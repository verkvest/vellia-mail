import type { Locale } from './types';

export interface TemplateContext {
  name?: string;
  email?: string;
  subject?: string;
  myEmail?: string;
  account?: string;
  date?: Date;
  locale?: Locale;
  timeZone?: string;
}

const ALIASES: Record<string, 'name' | 'email' | 'subject' | 'myEmail' | 'account' | 'date' | 'time'> = {
  имя: 'name',
  name: 'name',
  nombre: 'name',
  дата: 'date',
  date: 'date',
  fecha: 'date',
  email: 'email',
  почта: 'email',
  correo: 'email',
  тема: 'subject',
  subject: 'subject',
  asunto: 'subject',
  мояпочта: 'myEmail',
  myemail: 'myEmail',
  micorreo: 'myEmail',
  аккаунт: 'account',
  account: 'account',
  cuenta: 'account',
  время: 'time',
  time: 'time',
  hora: 'time',
};

const INTL_LOCALE: Record<Locale, string> = { ru: 'ru-RU', es: 'es-ES', en: 'en-GB' };

function formatDate(date: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(date);
}

function formatTime(date: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

export function renderTemplate(body: string, context: TemplateContext): string {
  const locale = context.locale ?? 'ru';
  const timeZone = context.timeZone ?? 'Europe/Madrid';
  const date = context.date ?? new Date();
  return body.replace(/\{([^{}]+)\}/g, (whole, raw: string) => {
    const key = ALIASES[raw.trim().toLocaleLowerCase()];
    if (!key) return whole;
    if (key === 'date') return formatDate(date, locale, timeZone);
    if (key === 'time') return formatTime(date, locale, timeZone);
    const value = context[key];
    return value && value.trim() ? value.trim() : whole;
  });
}

export function appendSignature(body: string, signature: string | undefined, enabled = true): string {
  const sign = signature?.trim();
  if (!enabled || !sign) return body;
  const trimmed = body.replace(/\s+$/g, '');
  if (trimmed.endsWith(sign)) return trimmed;
  return `${trimmed}\n\n-- \n${sign}`;
}

export function placeSignature(text: string, signature: string | undefined, enabled = true): string {
  const sign = signature?.trim();
  if (!enabled || !sign) return text;
  const block = `-- \n${sign}`;
  if (text.includes(block)) return text.replace(/\s+$/g, '');
  const match = text.match(/\n\n[^\n]{1,160}:\n>/);
  if (!match || match.index === undefined) return `${text.replace(/\s+$/g, '')}\n\n${block}`;
  const head = text.slice(0, match.index).replace(/\s+$/g, '');
  return `${head}\n\n${block}${text.slice(match.index)}`;
}

export function firstName(display: string | undefined, email: string | undefined): string {
  const source = (display || '').trim();
  if (source) return source.split(/\s+/)[0] ?? source;
  if (email?.includes('@')) return email.split('@')[0] ?? '';
  return '';
}

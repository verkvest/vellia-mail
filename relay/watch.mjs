import { connect as tlsConnect } from 'node:tls';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const relayUrl = (process.env.RELAY_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const secret = process.env.RELAY_SECRET || '';
const everyMs = Math.max(15, Number(process.env.WATCH_EVERY_SECONDS || 60)) * 1000;
const dataDir = process.env.DATA_DIR || new URL('./data/', import.meta.url).pathname;
const statePath = join(dataDir, 'seen.json');

if (!secret) {
  console.error('Задайте RELAY_SECRET.');
  process.exit(1);
}

function accounts() {
  const file = process.env.ACCOUNTS_FILE;
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
    console.error('Нужен ACCOUNTS_FILE или IMAP_HOST, IMAP_USER и IMAP_PASSWORD.');
    process.exit(1);
  }
  return [{
    label: process.env.IMAP_USER,
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    username: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
  }];
}

function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function decodeWords(value) {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, encoding, text) => {
    try {
      const bytes = encoding.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64')
        : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return text;
    }
  });
}

function openImap(account) {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host: account.host, port: account.port, servername: account.host });
    let buf = '';
    let greeted = false;
    const pending = [];
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(20000, () => fail(new Error(`${account.label}: timeout`)));
    socket.on('error', fail);
    function pump() {
      if (!greeted || !pending.length) return;
      const lines = buf.split(/\r?\n/);
      const index = lines.findIndex((line) => line.startsWith(`${pending[0].tag} `));
      if (index === -1) return;
      const block = lines.slice(0, index + 1);
      buf = lines.slice(index + 1).join('\n');
      const current = pending.shift();
      const status = block[index] || '';
      if (/\sOK(\s|$)/i.test(status)) current.resolve(block);
      else current.reject(new Error(`${account.label}: ${status.replaceAll(account.password, '[redacted]')}`));
      pump();
    }
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (!greeted) {
        const end = buf.indexOf('\n');
        if (end === -1) return;
        const greeting = buf.slice(0, end);
        buf = buf.slice(end + 1);
        greeted = true;
        if (!/\sOK(\s|$)/i.test(greeting) && !greeting.startsWith('* OK') && !greeting.includes('OK')) {
          fail(new Error(`${account.label}: нет приветствия IMAP`));
          return;
        }
      }
      pump();
    });
    socket.once('secureConnect', () => {
      resolve({
        command(tag, text) {
          return new Promise((ok, bad) => {
            pending.push({ tag, resolve: ok, reject: bad });
            socket.write(`${tag} ${text}\r\n`);
            pump();
          });
        },
        end() {
          socket.end();
        },
      });
    });
  });
}

function loadState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return {};
  }
}

async function notify(body) {
  const response = await fetch(`${relayUrl}/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ title: 'Vellia Mail', body }),
  });
  if (!response.ok) throw new Error(`relay ${response.status}`);
}

async function check(account, state) {
  const imap = await openImap(account);
  try {
    await imap.command('A1', `LOGIN ${quote(account.username)} ${quote(account.password)}`);
    await imap.command('A2', 'SELECT INBOX');
    const search = await imap.command('A3', 'UID SEARCH UNSEEN');
    const line = search.find((item) => item.startsWith('* SEARCH')) || '* SEARCH';
    const uids = line.replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean);
    const key = account.label || account.username;
    const previous = state[key];
    state[key] = uids;
    if (!previous) return;
    const known = new Set(previous);
    const fresh = uids.filter((uid) => !known.has(uid));
    if (!fresh.length) return;
    const sample = fresh.slice(-3);
    let summary = '';
    if (sample.length) {
      const fetched = await imap.command('A4', `UID FETCH ${sample.join(',')} BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)]`);
      const joined = decodeWords(fetched.join('\n'));
      const subjects = [...joined.matchAll(/^Subject:\s*(.+)$/gim)].map((match) => match[1].trim());
      const froms = [...joined.matchAll(/^From:\s*(.+)$/gim)].map((match) => match[1].trim());
      const firstFrom = (froms[0] || account.label || '').replace(/<.*>/, '').trim();
      const firstSubject = subjects[0] || 'новое письмо';
      summary = fresh.length === 1 ? `${firstFrom}: ${firstSubject}` : `${firstFrom}: ${firstSubject} (+${fresh.length - 1})`;
    }
    await notify(summary.slice(0, 180) || `Новые письма: ${fresh.length}`);
    console.log(`${key}: новых ${fresh.length}`);
  } finally {
    imap.command('A9', 'LOGOUT').catch(() => undefined);
    imap.end();
  }
}

async function tick() {
  const state = loadState();
  for (const account of accounts()) {
    try {
      await check(account, state);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'watch failed');
    }
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state));
}

await tick();
setInterval(() => void tick(), everyMs);

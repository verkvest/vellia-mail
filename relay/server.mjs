import { createHash, createPrivateKey, createSign, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import http2 from 'node:http2';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const port = Number(process.env.PORT || 8787);
const bind = process.env.BIND || '127.0.0.1';
const secret = process.env.RELAY_SECRET || '';
const dataDir = process.env.DATA_DIR || new URL('./data/', import.meta.url).pathname;
const devicesPath = join(dataDir, 'devices.json');
const bundleId = process.env.APPLE_BUNDLE_ID || 'es.verkvest.velliamail';
const apnsHost = process.env.APNS_ENV === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';

if (!secret) {
  console.error('Задайте RELAY_SECRET в окружении.');
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });

function loadDevices() {
  try {
    const parsed = JSON.parse(readFileSync(devicesPath, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.tokens ? parsed : { tokens: {} };
  } catch {
    return { tokens: {} };
  }
}

function saveDevices(store) {
  mkdirSync(dirname(devicesPath), { recursive: true });
  writeFileSync(devicesPath, JSON.stringify(store));
}

function authorized(header) {
  const value = String(header || '');
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const left = createHash('sha256').update(match[1]).digest();
  const right = createHash('sha256').update(secret).digest();
  return timingSafeEqual(left, right);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

let jwtCache = { token: '', exp: 0 };

function apnsJwt() {
  const now = Math.floor(Date.now() / 1000);
  if (jwtCache.token && jwtCache.exp - 60 > now) return jwtCache.token;
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const keyPath = process.env.APPLE_KEY_PATH;
  if (!teamId || !keyId || !keyPath) throw new Error('Нет APPLE_TEAM_ID, APPLE_KEY_ID или APPLE_KEY_PATH');
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString('base64url');
  const sign = createSign('SHA256');
  sign.update(`${header}.${body}`);
  sign.end();
  const signature = sign.sign({ key: createPrivateKey(readFileSync(keyPath)), dsaEncoding: 'ieee-p1363' });
  jwtCache = { token: `${header}.${body}.${Buffer.from(signature).toString('base64url')}`, exp: now + 50 * 60 };
  return jwtCache.token;
}

function sendApns(token, title, body) {
  const client = http2.connect(apnsHost);
  const hint = createHash('sha256').update(token).digest('hex').slice(0, 8);
  return new Promise((resolve) => {
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsJwt()}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });
    let status = 0;
    let raw = '';
    req.on('response', (headers) => {
      status = Number(headers[':status'] || 0);
    });
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      client.close();
      resolve({ status, hint, reason: raw.slice(0, 180) });
    });
    req.on('error', (error) => {
      client.close();
      resolve({ status: 0, hint, reason: error.message });
    });
    req.end(JSON.stringify({ aps: { alert: { title, body }, sound: 'default' } }));
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (!authorized(req.headers.authorization)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      const store = loadDevices();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ devices: Object.keys(store.tokens).length }));
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/register' || url.pathname === '/devices')) {
      const body = await readBody(req);
      const token = String(body.token || '').replace(/\s+/g, '');
      if (!/^[A-Fa-f0-9]{32,200}$/.test(token)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'token' }));
        return;
      }
      const store = loadDevices();
      store.tokens[token] = { platform: String(body.platform || 'ios'), seenAt: Date.now() };
      saveDevices(store);
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/notify') {
      const body = await readBody(req);
      const title = String(body.title || 'Vellia Mail').slice(0, 80);
      const text = String(body.body || '').slice(0, 180);
      if (!text) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'body' }));
        return;
      }
      const store = loadDevices();
      const results = [];
      for (const token of Object.keys(store.tokens)) {
        const result = await sendApns(token, title, text);
        results.push({ hint: result.hint, status: result.status });
        if (result.status === 410 || result.status === 400) delete store.tokens[token];
        if (result.status !== 200) console.error(`apns ${result.status} ${result.hint} ${result.reason}`);
      }
      saveDevices(store);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sent: results.filter((item) => item.status === 200).length, results }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'failed' }));
    console.error(error instanceof Error ? error.message : 'failed');
  }
});

server.listen(port, bind, () => {
  console.log(`Vellia relay слушает ${bind}:${port}`);
});

export function redact(value: string): string {
  let out = value;
  out = out.replace(/AUTHENTICATE XOAUTH2\s+\S+/gi, 'AUTHENTICATE XOAUTH2 [redacted]');
  out = out.replace(/AUTH PLAIN\s+\S+/gi, 'AUTH PLAIN [redacted]');
  out = out.replace(/AUTH LOGIN\s+\S+/gi, 'AUTH LOGIN [redacted]');
  out = out.replace(/LOGIN\s+(\S+)\s+(\S+)/gi, 'LOGIN $1 [redacted]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
  out = out.replace(/refresh_token=[^&\s]+/gi, 'refresh_token=[redacted]');
  out = out.replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]');
  out = out.replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"[redacted]"');
  out = out.replace(/"refreshToken"\s*:\s*"[^"]*"/gi, '"refreshToken":"[redacted]"');
  out = out.replace(/"accessToken"\s*:\s*"[^"]*"/gi, '"accessToken":"[redacted]"');
  return out;
}

export function publicError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redact(raw).slice(0, 280);
}

export function assertNoSecrets(value: unknown, path = 'state'): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/password|token|secret|authorization/i.test(key)) {
      throw new Error(`Refusing to persist ${path}.${key}`);
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
}

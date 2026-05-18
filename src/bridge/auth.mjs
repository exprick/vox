import crypto from 'node:crypto';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export class HttpError extends Error {
  constructor(status, message, code = 'HTTP_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function authConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const configured = Boolean(supabaseUrl && supabaseAnonKey);
  return {
    required: readBooleanEnv('VOX_AUTH_REQUIRED', true),
    configured,
    supabaseUrl,
    supabaseAnonKey,
    allowedEmails: parseList(process.env.VOX_ALLOWED_EMAILS),
    allowedDomains: parseList(process.env.VOX_ALLOWED_DOMAINS),
  };
}

export function publicAuthConfig() {
  const cfg = authConfig();
  return {
    required: cfg.required,
    configured: cfg.configured,
    provider: 'supabase',
    supabaseUrl: cfg.supabaseUrl,
    supabaseAnonKey: cfg.supabaseAnonKey,
    allowlistConfigured: cfg.allowedEmails.length > 0 || cfg.allowedDomains.length > 0,
  };
}

export async function authenticateRequest(req) {
  const cfg = authConfig();
  if (!cfg.required) {
    return makeUser({
      id: 'dev-local',
      email: 'dev@local.vox',
      name: 'Local Vox Dev',
      provider: 'dev',
    });
  }
  if (!cfg.configured) {
    throw new HttpError(503, 'Vox auth is required but Supabase is not configured', 'AUTH_NOT_CONFIGURED');
  }

  const token = readBearerToken(req);
  if (!token) throw new HttpError(401, 'Missing bearer token', 'AUTH_MISSING');
  if (cfg.allowedEmails.length === 0 && cfg.allowedDomains.length === 0) {
    throw new HttpError(503, 'Vox allowlist is empty; deployment misconfigured', 'AUTH_ALLOWLIST_EMPTY');
  }

  const resp = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: cfg.supabaseAnonKey,
    },
  });
  if (!resp.ok) {
    throw new HttpError(401, `Supabase auth failed: ${resp.status}`, 'AUTH_INVALID');
  }
  const profile = await resp.json();
  const email = String(profile.email || '').toLowerCase();
  if (!email) throw new HttpError(403, 'Authenticated user has no email', 'AUTH_EMAIL_MISSING');
  if (!isAllowed(email, cfg)) {
    throw new HttpError(403, 'This email is not on the Vox early access allowlist', 'AUTH_NOT_ALLOWED');
  }

  return makeUser({
    id: String(profile.id || email),
    email,
    name: profile.user_metadata?.full_name || profile.user_metadata?.name || email,
    provider: 'supabase',
  });
}

export function readBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || '';
}

function isAllowed(email, cfg) {
  if (cfg.allowedEmails.includes(email)) return true;
  const domain = email.split('@')[1] || '';
  return cfg.allowedDomains.includes(domain);
}

function makeUser({ id, email, name, provider }) {
  const stableId = id || email || provider;
  return {
    id: stableId,
    email,
    name,
    provider,
    safetyIdentifier: crypto.createHash('sha256').update(`vox:${stableId}`).digest('hex'),
  };
}

function parseList(value = '') {
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function readBooleanEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
}

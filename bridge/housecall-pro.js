import { URL } from 'node:url';

const DEFAULT_BASE_URL = 'https://api.housecallpro.com';
const DEFAULT_TIMEOUT_MS = 30000;

const runtimeTokenState = {
  accessToken: process.env.HOUSECALL_PRO_ACCESS_TOKEN || '',
  refreshToken: process.env.HOUSECALL_PRO_REFRESH_TOKEN || '',
  expiresAtEpochMs: 0,
};

function normalizeBaseUrl(url) {
  const raw = typeof url === 'string' && url.trim() ? url.trim() : DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

function getTokenUrl(baseUrl) {
  return process.env.HOUSECALL_PRO_TOKEN_URL || `${baseUrl}/oauth/token`;
}

function getRequestTimeoutMs() {
  const parsed = Number.parseInt(process.env.HOUSECALL_PRO_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function buildUrl(path, query) {
  if (!path || typeof path !== 'string') {
    throw new Error('Housecall path must be a non-empty string');
  }
  const baseUrl = normalizeBaseUrl(process.env.HOUSECALL_PRO_API_BASE);
  const resolved = path.startsWith('http://') || path.startsWith('https://') ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  const url = new URL(resolved);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, `${value}`);
    }
  }
  return url;
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

async function refreshAccessToken() {
  const clientId = process.env.HOUSECALL_PRO_CLIENT_ID;
  const clientSecret = process.env.HOUSECALL_PRO_CLIENT_SECRET;
  const refreshToken = runtimeTokenState.refreshToken || process.env.HOUSECALL_PRO_REFRESH_TOKEN || '';
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Housecall Pro OAuth credentials for token refresh');
  }

  const baseUrl = normalizeBaseUrl(process.env.HOUSECALL_PRO_API_BASE);
  const tokenUrl = getTokenUrl(baseUrl);
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', refreshToken);
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(getRequestTimeoutMs()),
  });

  const payload = await parseResponseBody(res);
  if (!res.ok) {
    const summary =
      typeof payload === 'string'
        ? payload.slice(0, 500)
        : JSON.stringify(payload || { message: 'token_refresh_failed' }).slice(0, 500);
    throw new Error(`Housecall token refresh failed (${res.status}): ${summary}`);
  }

  if (!payload || typeof payload !== 'object' || !payload.access_token) {
    throw new Error('Housecall token refresh returned invalid response');
  }

  runtimeTokenState.accessToken = payload.access_token;
  runtimeTokenState.refreshToken = payload.refresh_token || refreshToken;
  const expiresInSec = Number(payload.expires_in || 3600);
  runtimeTokenState.expiresAtEpochMs = Date.now() + Math.max(60, expiresInSec - 60) * 1000;
  return runtimeTokenState.accessToken;
}

function hasStaticApiKey() {
  return Boolean(process.env.HOUSECALL_PRO_API_KEY);
}

function hasBearerToken() {
  return Boolean(runtimeTokenState.accessToken || process.env.HOUSECALL_PRO_ACCESS_TOKEN);
}

function hasRefreshFlow() {
  const refreshToken = runtimeTokenState.refreshToken || process.env.HOUSECALL_PRO_REFRESH_TOKEN;
  return Boolean(process.env.HOUSECALL_PRO_CLIENT_ID && process.env.HOUSECALL_PRO_CLIENT_SECRET && refreshToken);
}

async function getBearerToken(forceRefresh = false) {
  if (hasStaticApiKey()) {
    return process.env.HOUSECALL_PRO_API_KEY;
  }

  const cachedAccessToken = runtimeTokenState.accessToken || process.env.HOUSECALL_PRO_ACCESS_TOKEN || '';
  if (!forceRefresh && cachedAccessToken) {
    if (!runtimeTokenState.expiresAtEpochMs || Date.now() < runtimeTokenState.expiresAtEpochMs) {
      return cachedAccessToken;
    }
  }

  if (hasRefreshFlow()) {
    return refreshAccessToken();
  }

  if (cachedAccessToken) {
    return cachedAccessToken;
  }

  throw new Error(
    'Housecall credentials are missing. Set HOUSECALL_PRO_API_KEY, or OAuth env vars (HOUSECALL_PRO_CLIENT_ID, HOUSECALL_PRO_CLIENT_SECRET, HOUSECALL_PRO_REFRESH_TOKEN).',
  );
}

export function getHousecallConfigSummary() {
  const baseUrl = normalizeBaseUrl(process.env.HOUSECALL_PRO_API_BASE);
  return {
    baseUrl,
    authMode: hasStaticApiKey() ? 'api_key' : hasRefreshFlow() ? 'oauth_refresh' : hasBearerToken() ? 'access_token' : 'missing',
    hasApiKey: hasStaticApiKey(),
    hasAccessToken: hasBearerToken(),
    hasRefreshToken: Boolean(runtimeTokenState.refreshToken || process.env.HOUSECALL_PRO_REFRESH_TOKEN),
    hasClientCredentials: Boolean(process.env.HOUSECALL_PRO_CLIENT_ID && process.env.HOUSECALL_PRO_CLIENT_SECRET),
    createEstimatePath: process.env.HOUSECALL_PRO_CREATE_ESTIMATE_PATH || '/v1/estimates',
    addToJobEstimatePath: process.env.HOUSECALL_PRO_ADD_TO_JOB_ESTIMATE_PATH || '/v1/jobs/{job_id}/estimates',
    updateEstimatePath: process.env.HOUSECALL_PRO_UPDATE_ESTIMATE_PATH || '/v1/estimates/{estimate_id}',
    addOptionNotePath:
      process.env.HOUSECALL_PRO_ADD_OPTION_NOTE_PATH ||
      '/v1/estimates/{estimate_id}/options/{estimate_option_id}/notes',
    appointmentLookupPath: process.env.HOUSECALL_PRO_APPOINTMENT_LOOKUP_PATH || '',
  };
}

export async function housecallRequest({ path, method = 'GET', query, body, headers } = {}) {
  const requestMethod = `${method || 'GET'}`.toUpperCase();
  const url = buildUrl(path, query);
  const timeoutMs = getRequestTimeoutMs();

  const execute = async (forceRefresh) => {
    const bearerToken = await getBearerToken(forceRefresh);
    const requestHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${bearerToken}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers && typeof headers === 'object' ? headers : {}),
    };

    const res = await fetch(url, {
      method: requestMethod,
      headers: requestHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const parsedBody = await parseResponseBody(res);
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      body: parsedBody,
      headers: Object.fromEntries(res.headers.entries()),
      url: url.toString(),
      method: requestMethod,
    };
  };

  let result = await execute(false);
  if (result.status === 401 && !hasStaticApiKey() && hasRefreshFlow()) {
    result = await execute(true);
  }
  return result;
}

export async function testHousecallConnection(path) {
  const testPath = path || process.env.HOUSECALL_PRO_TEST_PATH || '/v1/customers';
  return housecallRequest({
    path: testPath,
    method: 'GET',
    query: { page_size: 1 },
  });
}

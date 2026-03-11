import { createSign } from 'node:crypto';

const DEFAULT_API_BASE = 'https://www.googleapis.com/drive/v3';
const DEFAULT_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

const runtimeTokenState = {
  accessToken: process.env.GDRIVE_ACCESS_TOKEN || '',
  expiresAtEpochMs: 0,
};

function parseScopes(raw) {
  if (!raw || typeof raw !== 'string') return ['https://www.googleapis.com/auth/drive.file'];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseBoolean(raw, fallback = false) {
  if (raw == null) return fallback;
  const normalized = `${raw}`.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function hasServiceAccountJson() {
  return Boolean(process.env.GDRIVE_SERVICE_ACCOUNT_JSON && process.env.GDRIVE_SERVICE_ACCOUNT_JSON.trim());
}

function hasServiceAccountFields() {
  return Boolean(process.env.GDRIVE_CLIENT_EMAIL && process.env.GDRIVE_PRIVATE_KEY);
}

function hasOAuthRefresh() {
  return Boolean(
    process.env.GDRIVE_CLIENT_ID &&
      process.env.GDRIVE_CLIENT_SECRET &&
      process.env.GDRIVE_REFRESH_TOKEN,
  );
}

function hasAccessToken() {
  return Boolean(process.env.GDRIVE_ACCESS_TOKEN && process.env.GDRIVE_ACCESS_TOKEN.trim());
}

function resolveAuthMode() {
  if (hasServiceAccountJson() || hasServiceAccountFields()) return 'service_account';
  if (hasOAuthRefresh()) return 'oauth_refresh';
  if (hasAccessToken()) return 'access_token';
  return 'missing';
}

function base64UrlEncode(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(`${value}`);
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizePrivateKey(value = '') {
  return `${value}`.replace(/\\n/g, '\n').trim();
}

function parseServiceAccountJson() {
  const raw = process.env.GDRIVE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      clientEmail: parsed.client_email || '',
      privateKey: normalizePrivateKey(parsed.private_key || ''),
      tokenUrl: parsed.token_uri || DEFAULT_TOKEN_URL,
    };
  } catch (_) {
    return null;
  }
}

function getServiceAccountCredentials() {
  const fromJson = parseServiceAccountJson();
  if (fromJson?.clientEmail && fromJson?.privateKey) return fromJson;

  const clientEmail = process.env.GDRIVE_CLIENT_EMAIL || '';
  const privateKey = normalizePrivateKey(process.env.GDRIVE_PRIVATE_KEY || '');
  if (clientEmail && privateKey) {
    return {
      clientEmail,
      privateKey,
      tokenUrl: process.env.GDRIVE_TOKEN_URL || DEFAULT_TOKEN_URL,
    };
  }
  return null;
}

function getTokenUrl() {
  return process.env.GDRIVE_TOKEN_URL || DEFAULT_TOKEN_URL;
}

function getDriveApiBase() {
  return (process.env.GDRIVE_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
}

function getDriveUploadBase() {
  return (process.env.GDRIVE_UPLOAD_BASE || DEFAULT_UPLOAD_BASE).replace(/\/+$/, '');
}

function getMaxDownloadBytes() {
  const raw = Number.parseInt(process.env.GDRIVE_MAX_DOWNLOAD_BYTES || `${DEFAULT_MAX_DOWNLOAD_BYTES}`, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_DOWNLOAD_BYTES;
}

async function parseResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function buildRequestError(prefix, status, body) {
  const summary =
    typeof body === 'string'
      ? body.slice(0, 600)
      : JSON.stringify(body || {}).slice(0, 600);
  return new Error(`${prefix} (${status}): ${summary}`);
}

async function exchangeJwtForAccessToken() {
  const credentials = getServiceAccountCredentials();
  if (!credentials) throw new Error('Missing Google Drive service account credentials');

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: credentials.clientEmail,
    scope: parseScopes(process.env.GDRIVE_SCOPES).join(' '),
    aud: credentials.tokenUrl || DEFAULT_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(credentials.privateKey);
  const assertion = `${signingInput}.${base64UrlEncode(signature)}`;

  const body = new URLSearchParams();
  body.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  body.set('assertion', assertion);

  const tokenUrl = credentials.tokenUrl || DEFAULT_TOKEN_URL;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const payload = await parseResponseBody(res);
  if (!res.ok) throw buildRequestError('Google token exchange failed', res.status, payload);
  if (!payload?.access_token) throw new Error('Google token exchange returned no access_token');

  runtimeTokenState.accessToken = payload.access_token;
  const expiresIn = Number(payload.expires_in || 3600);
  runtimeTokenState.expiresAtEpochMs = Date.now() + Math.max(60, expiresIn - 60) * 1000;
  return runtimeTokenState.accessToken;
}

async function refreshAccessToken() {
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN || '';
  const clientId = process.env.GDRIVE_CLIENT_ID || '';
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET || '';
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('Missing GDRIVE OAuth refresh credentials');
  }

  const body = new URLSearchParams();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('refresh_token', refreshToken);
  body.set('grant_type', 'refresh_token');

  const res = await fetch(getTokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const payload = await parseResponseBody(res);
  if (!res.ok) throw buildRequestError('Google OAuth refresh failed', res.status, payload);
  if (!payload?.access_token) throw new Error('Google OAuth refresh returned no access_token');

  runtimeTokenState.accessToken = payload.access_token;
  const expiresIn = Number(payload.expires_in || 3600);
  runtimeTokenState.expiresAtEpochMs = Date.now() + Math.max(60, expiresIn - 60) * 1000;
  return runtimeTokenState.accessToken;
}

async function getAccessToken(forceRefresh = false) {
  const staticAccessToken = process.env.GDRIVE_ACCESS_TOKEN || '';
  if (resolveAuthMode() === 'access_token' && staticAccessToken) return staticAccessToken;

  if (
    !forceRefresh &&
    runtimeTokenState.accessToken &&
    (!runtimeTokenState.expiresAtEpochMs || Date.now() < runtimeTokenState.expiresAtEpochMs)
  ) {
    return runtimeTokenState.accessToken;
  }

  const authMode = resolveAuthMode();
  if (authMode === 'service_account') return exchangeJwtForAccessToken();
  if (authMode === 'oauth_refresh') return refreshAccessToken();
  if (runtimeTokenState.accessToken) return runtimeTokenState.accessToken;

  throw new Error(
    'Google Drive credentials are missing. Set service account credentials, OAuth refresh credentials, or GDRIVE_ACCESS_TOKEN.',
  );
}

async function gdriveRequest({
  path,
  method = 'GET',
  query,
  body,
  headers,
  base = 'api',
  rawBody,
}) {
  const baseUrl = base === 'upload' ? getDriveUploadBase() : getDriveApiBase();
  const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, `${value}`);
    }
  }

  const execute = async (forceRefresh) => {
    const token = await getAccessToken(forceRefresh);
    const requestHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(rawBody ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    };
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      ...(rawBody ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return response;
  };

  let response = await execute(false);
  if (
    response.status === 401 &&
    (resolveAuthMode() === 'oauth_refresh' || resolveAuthMode() === 'service_account')
  ) {
    response = await execute(true);
  }
  return response;
}

function driveQueryDefaults(sharedDriveId, folderId) {
  const useSharedDrive = parseBoolean(process.env.GDRIVE_USE_SHARED_DRIVE, false) || Boolean(sharedDriveId);
  return {
    supportsAllDrives: useSharedDrive ? 'true' : undefined,
    includeItemsFromAllDrives: useSharedDrive ? 'true' : undefined,
    corpora: sharedDriveId ? 'drive' : undefined,
    driveId: sharedDriveId || undefined,
    q: folderId ? `'${folderId}' in parents and trashed = false` : undefined,
  };
}

export async function listDriveFiles(options = {}) {
  const folderId = options.folder_id || options.folderId || process.env.GDRIVE_FOLDER_ID || '';
  const sharedDriveId = options.shared_drive_id || options.sharedDriveId || process.env.GDRIVE_SHARED_DRIVE_ID || '';
  const defaults = driveQueryDefaults(sharedDriveId, folderId);
  const query = {
    ...defaults,
    q: options.q || defaults.q,
    pageSize: options.page_size || options.pageSize || 25,
    pageToken: options.page_token || options.pageToken,
    orderBy: options.order_by || options.orderBy,
    fields:
      options.fields ||
      'nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink, webContentLink)',
  };

  const res = await gdriveRequest({
    path: '/files',
    method: 'GET',
    query,
  });
  const payload = await parseResponseBody(res);
  if (!res.ok) throw buildRequestError('Google Drive list files failed', res.status, payload);

  return {
    files: Array.isArray(payload?.files) ? payload.files : [],
    nextPageToken: payload?.nextPageToken || null,
  };
}

export async function uploadDriveFile(options = {}) {
  const name = `${options.name || ''}`.trim();
  const contentBase64 = `${options.content_base64 || options.contentBase64 || ''}`.trim();
  if (!name) throw new Error('name is required');
  if (!contentBase64) throw new Error('content_base64 is required');

  const folderId = options.folder_id || options.folderId || process.env.GDRIVE_FOLDER_ID || '';
  const sharedDriveId = options.shared_drive_id || options.sharedDriveId || process.env.GDRIVE_SHARED_DRIVE_ID || '';
  const mimeType = options.mime_type || options.mimeType || 'application/octet-stream';
  const metadata = {
    name,
    mimeType,
    ...(folderId ? { parents: [folderId] } : {}),
  };
  const fileBuffer = Buffer.from(contentBase64, 'base64');

  const boundary = `gdrive-boundary-${Date.now()}`;
  const metadataPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    'utf8',
  );
  const mediaHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    'utf8',
  );
  const closing = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const rawBody = Buffer.concat([metadataPart, mediaHeader, fileBuffer, closing]);

  const res = await gdriveRequest({
    path: '/files',
    method: 'POST',
    base: 'upload',
    query: {
      uploadType: 'multipart',
      supportsAllDrives:
        parseBoolean(process.env.GDRIVE_USE_SHARED_DRIVE, false) || sharedDriveId ? 'true' : undefined,
    },
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    rawBody,
  });

  const payload = await parseResponseBody(res);
  if (!res.ok) throw buildRequestError('Google Drive upload failed', res.status, payload);
  return payload;
}

export async function downloadDriveFile(options = {}) {
  const fileId = `${options.file_id || options.fileId || ''}`.trim();
  if (!fileId) throw new Error('file_id is required');
  const sharedDriveId = options.shared_drive_id || options.sharedDriveId || process.env.GDRIVE_SHARED_DRIVE_ID || '';
  const res = await gdriveRequest({
    path: `/files/${encodeURIComponent(fileId)}`,
    method: 'GET',
    query: {
      alt: 'media',
      supportsAllDrives:
        parseBoolean(process.env.GDRIVE_USE_SHARED_DRIVE, false) || sharedDriveId ? 'true' : undefined,
    },
  });
  if (!res.ok) {
    const payload = await parseResponseBody(res);
    throw buildRequestError('Google Drive download failed', res.status, payload);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const maxBytes = getMaxDownloadBytes();
  if (buf.byteLength > maxBytes) {
    throw new Error(`Google Drive download too large (${buf.byteLength} bytes > ${maxBytes})`);
  }
  return {
    file_id: fileId,
    mime_type: res.headers.get('content-type') || 'application/octet-stream',
    size: buf.byteLength,
    content_base64: buf.toString('base64'),
  };
}

export function getGoogleDriveConfigSummary() {
  return {
    authMode: resolveAuthMode(),
    hasServiceAccountJson: hasServiceAccountJson(),
    hasServiceAccountFields: hasServiceAccountFields(),
    hasOAuthClientCredentials: Boolean(process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET),
    hasOAuthRefreshToken: Boolean(process.env.GDRIVE_REFRESH_TOKEN),
    hasAccessToken: hasAccessToken(),
    folderId: process.env.GDRIVE_FOLDER_ID || '',
    sharedDriveId: process.env.GDRIVE_SHARED_DRIVE_ID || '',
    useSharedDrive: parseBoolean(process.env.GDRIVE_USE_SHARED_DRIVE, false),
    scopes: parseScopes(process.env.GDRIVE_SCOPES),
    apiBase: getDriveApiBase(),
    uploadBase: getDriveUploadBase(),
    maxDownloadBytes: getMaxDownloadBytes(),
  };
}

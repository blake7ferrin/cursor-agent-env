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
    apiBase: process.env.GDRIVE_API_BASE || 'https://www.googleapis.com/drive/v3',
    uploadBase: process.env.GDRIVE_UPLOAD_BASE || 'https://www.googleapis.com/upload/drive/v3',
  };
}

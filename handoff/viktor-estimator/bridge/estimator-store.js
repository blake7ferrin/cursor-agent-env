import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EstimatorValidationError,
  getDefaultEstimatorConfig,
  normalizeCatalogItem,
  normalizeEstimatorConfig,
} from './estimator-domain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = process.env.ESTIMATOR_STORE_PATH || path.join(__dirname, 'data', 'estimator.json');

const profilesByUser = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toUserId(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new EstimatorValidationError('user_id is required');
  }
  return value.trim();
}

function normalizeProfile(value) {
  const config = normalizeEstimatorConfig(value?.config || {}, {
    base: getDefaultEstimatorConfig(),
  });
  const catalog = Array.isArray(value?.catalog)
    ? value.catalog.map((item) => normalizeCatalogItem(item))
    : [];
  return { config, catalog };
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    const users = parsed?.users && typeof parsed.users === 'object' ? parsed.users : {};
    for (const [userId, profile] of Object.entries(users)) {
      if (!userId.trim()) continue;
      try {
        profilesByUser.set(userId, normalizeProfile(profile));
      } catch (err) {
        console.error(`Skipping invalid estimator profile for ${userId}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`Failed to load estimator store at ${STORE_PATH}: ${err.message}`);
  }
}

function persistStore() {
  try {
    ensureParentDir(STORE_PATH);
    const tmpPath = `${STORE_PATH}.tmp`;
    const users = Object.fromEntries(profilesByUser);
    const data = JSON.stringify({ users }, null, 2);
    fs.writeFileSync(tmpPath, data, 'utf8');
    fs.renameSync(tmpPath, STORE_PATH);
  } catch (err) {
    console.error(`Failed to persist estimator store at ${STORE_PATH}: ${err.message}`);
  }
}

function ensureProfile(userId) {
  const normalizedUserId = toUserId(userId);
  let profile = profilesByUser.get(normalizedUserId);
  if (!profile) {
    profile = {
      config: getDefaultEstimatorConfig(),
      catalog: [],
    };
    profilesByUser.set(normalizedUserId, profile);
  }
  return profile;
}

loadStore();

export async function getEstimatorProfile(userId) {
  const profile = ensureProfile(userId);
  return clone(profile);
}

export async function upsertEstimatorConfig(userId, configPatch = {}) {
  if (!configPatch || typeof configPatch !== 'object') {
    throw new EstimatorValidationError('config must be an object');
  }
  const profile = ensureProfile(userId);
  profile.config = normalizeEstimatorConfig(configPatch, { base: profile.config });
  persistStore();
  return clone(profile.config);
}

export async function replaceEstimatorCatalog(userId, items = []) {
  if (!Array.isArray(items)) {
    throw new EstimatorValidationError('items must be an array');
  }
  const profile = ensureProfile(userId);
  const dedupeBySku = new Map();
  for (const item of items) {
    const normalized = normalizeCatalogItem(item);
    dedupeBySku.set(normalized.sku, normalized);
  }
  profile.catalog = Array.from(dedupeBySku.values());
  persistStore();
  return clone(profile.catalog);
}

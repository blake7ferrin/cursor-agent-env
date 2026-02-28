/**
 * Housecall Pro API client.
 * Uses HOUSECALL_PRO_ACCESS_TOKEN for Bearer auth.
 * @see https://docs.housecallpro.com/docs/housecall-public-api
 */

const HCP_BASE = process.env.HOUSECALL_PRO_BASE || 'https://api.housecallpro.com';

function getAccessToken() {
  const token =
    process.env.HOUSECALL_PRO_ACCESS_TOKEN ||
    process.env.HCP_ACCESS_TOKEN ||
    process.env.HCP_API_KEY;
  if (!token) {
    throw new Error('Missing HOUSECALL_PRO_ACCESS_TOKEN, HCP_ACCESS_TOKEN, or HCP_API_KEY');
  }
  return token;
}

async function apiCall(method, path, body = null) {
  const token = getAccessToken();
  const url = path.startsWith('http') ? path : `${HCP_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`HCP API ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data) || text;
    throw new Error(`HCP API ${method} ${path}: ${res.status} ${msg}`);
  }
  return data;
}

/**
 * List customers (paginated).
 * @param {object} params - Query params: per_page, page, search, etc.
 */
async function listCustomers(params = {}) {
  const q = new URLSearchParams(params).toString();
  const path = `/customers${q ? `?${q}` : ''}`;
  return apiCall('GET', path);
}

/**
 * Try OAuth client_credentials exchange if we have client_id + secret.
 */
async function refreshAccessToken() {
  const clientId = process.env.HCP_CLIENT_ID || process.env.HOUSECALL_PRO_CLIENT_ID;
  const clientSecret = process.env.HCP_CLIENT_SECRET || process.env.HOUSECALL_PRO_CLIENT_SECRET || process.env.HCP_API_KEY;
  if (!clientId || !clientSecret) return null;
  const res = await fetch(`${HCP_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`OAuth token failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

/**
 * Create a customer.
 * @param {object} customer - { first_name, last_name, email?, phone?, address? }
 */
async function createCustomer(customer) {
  return apiCall('POST', '/customers', customer);
}

/**
 * Get or create customer by name. Returns customer id.
 */
async function getOrCreateCustomer(firstName, lastName, options = {}) {
  const search = [firstName, lastName].filter(Boolean).join(' ');
  const list = await listCustomers({ search, per_page: 20 });
  const customers = list.customers ?? list.data ?? list;
  if (Array.isArray(customers)) {
    const found = customers.find(
      (c) =>
        (c.first_name ?? c.firstName ?? '').toLowerCase() === (firstName ?? '').toLowerCase() &&
        (c.last_name ?? c.lastName ?? '').toLowerCase() === (lastName ?? '').toLowerCase(),
    );
    if (found) return found.id ?? found.customer_id;
  }
  const created = await createCustomer({
    first_name: firstName,
    last_name: lastName,
    ...options,
  });
  return created.id ?? created.customer_id ?? created.customer?.id;
}

/**
 * Create a job (required before estimate in some flows).
 */
async function createJob(job) {
  return apiCall('POST', '/jobs', job);
}

/**
 * Create an estimate.
 * @param {object} params - { customer_id, options: [{ name, total_amount (cents), line_items? }] }
 */
async function createEstimate(params) {
  return apiCall('POST', '/estimates', params);
}

export { getAccessToken, apiCall, listCustomers, createCustomer, getOrCreateCustomer, createJob, createEstimate };

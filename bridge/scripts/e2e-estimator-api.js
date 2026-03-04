/**
 * End-to-end test for the bridge estimator API.
 * Verifies: health, profile, changeout-plan (imported catalog), estimate (JSON + HTML), Housecall dry-run.
 *
 * Usage:
 *   Set BRIDGE_AUTH_TOKEN (required). Optionally BASE_URL (default http://localhost:3000), USER_ID (default e2e-test-user).
 *   With bridge running: npm run test:e2e   (or: node scripts/e2e-estimator-api.js)
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH_TOKEN = process.env.BRIDGE_AUTH_TOKEN;
const USER_ID = process.env.USER_ID || 'e2e-test-user';

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': USER_ID,
  ...(AUTH_TOKEN && { Authorization: `Bearer ${AUTH_TOKEN}` }),
};

const results = { ok: [], fail: [], notes: [] };

function log(step, message, detail = null) {
  const line = detail ? `${step}: ${message} ${JSON.stringify(detail)}` : `${step}: ${message}`;
  console.log(line);
  return line;
}

function note(step, message) {
  results.notes.push({ step, message });
  console.log(`  → ${message}`);
}

async function request(method, path, body = null) {
  const url = `${BASE_URL}${path}`;
  const opts = { method, headers };
  if (body && (method === 'POST' || method === 'PUT')) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    const msg = err?.cause?.code === 'ECONNREFUSED' ? 'Bridge not reachable (connection refused). Start the bridge first.' : err.message;
    throw new Error(msg);
  }
  const contentType = res.headers.get('content-type') || '';
  let data = null;
  const text = await res.text();
  if (contentType.includes('application/json')) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { _raw: text };
    }
  } else {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log('\n--- E2E Estimator API test ---');
  console.log(`BASE_URL=${BASE_URL}  USER_ID=${USER_ID}  AUTH=${AUTH_TOKEN ? 'set' : 'NOT SET'}\n`);

  if (!AUTH_TOKEN) {
    console.error('BRIDGE_AUTH_TOKEN is required. Set it in the environment or .env.');
    process.exit(1);
  }

  // 1. Health
  const health = await request('GET', '/health');
  if (!health.ok) {
    log('health', 'FAIL', { status: health.status });
    results.fail.push({ step: 'health', error: `status ${health.status}` });
    console.error('\nBridge is not reachable or not healthy. Start it with: cd bridge && BRIDGE_AUTH_TOKEN=xxx npm run dev');
    process.exit(1);
  }
  log('health', 'OK', health.data);
  results.ok.push('health');

  // 2. Profile (stored config/catalog only; runtime merges imported catalog later)
  const profileRes = await request('GET', '/estimator/profile');
  if (!profileRes.ok) {
    log('profile', 'FAIL', { status: profileRes.status, body: profileRes.data });
    results.fail.push({ step: 'profile', error: profileRes.data });
  } else {
    const { config, catalog_count } = profileRes.data;
    log('profile', 'OK', { catalog_count, laborRate: config?.laborRatePerHour, targetMargin: config?.targetGrossMargin });
    results.ok.push('profile');
    if (catalog_count === 0) note('profile', 'Stored catalog is empty; estimate/changeout-plan use imported catalog at runtime.');
  }

  // 3. Changeout plan (uses imported catalog by default)
  const planBody = {
    user_id: USER_ID,
    intake: {
      tonnage: 3,
      systemType: 'Heat Pump',
      residential: true,
    },
    customer: { name: 'E2E Test Customer' },
    project: { summary: 'E2E test changeout' },
  };
  const planRes = await request('POST', '/estimator/changeout-plan', planBody);
  if (!planRes.ok) {
    log('changeout-plan', 'FAIL', { status: planRes.status, body: planRes.data });
    results.fail.push({ step: 'changeout-plan', error: planRes.data });
    if (planRes.data?.catalog_runtime?.imported_catalog_count === 0) {
      note('changeout-plan', 'No imported catalog. Run: cd bridge && npm run ingest -- --profile preferred');
    }
  } else {
    const { plan, catalog_runtime } = planRes.data;
    log('changeout-plan', 'OK', {
      lane: plan?.lane,
      recommended_options: plan?.recommended_options?.length ?? 0,
      imported_catalog_count: catalog_runtime?.imported_catalog_count,
    });
    results.ok.push('changeout-plan');

    // 4. Estimate (JSON then HTML) using selection from plan or first recommended option
    let selections = plan?.draft_estimate_request?.selections;
    if (!selections?.length && Array.isArray(plan?.recommended_options) && plan.recommended_options.length > 0) {
      const first = plan.recommended_options[0];
      selections = [{ sku: first.sku, quantity: 1 }];
      note('estimate', `Using first recommended option SKU: ${first.sku}`);
    }

    if (!selections?.length) {
      log('estimate', 'SKIP', 'No selections available from changeout-plan (no options or no draft_estimate_request).');
      results.notes.push({ step: 'estimate', message: 'Skipped: no selections from plan' });
    } else {
      const estimateBody = {
        user_id: USER_ID,
        selections,
        customer: { name: 'E2E Test Customer' },
        project: { summary: 'E2E test estimate' },
        output: 'json',
      };
      const estRes = await request('POST', '/estimator/estimate', estimateBody);
      if (!estRes.ok) {
        log('estimate', 'FAIL', { status: estRes.status, body: estRes.data });
        results.fail.push({ step: 'estimate', error: estRes.data });
      } else {
        const { estimate, catalog_runtime: catRuntime } = estRes.data;
        log('estimate', 'OK', {
          estimate_id: estimate?.estimate_id,
          grandTotal: estimate?.totals?.grandTotal,
          achievedGrossMargin: estimate?.totals?.achievedGrossMargin,
          effective_catalog_count: catRuntime?.effective_catalog_count,
        });
        results.ok.push('estimate');

        // HTML output
        const htmlBody = { ...estimateBody, output: 'html' };
        const htmlRes = await request('POST', '/estimator/estimate', htmlBody);
        if (htmlRes.ok && typeof htmlRes.data === 'string') {
          const outPath = join(__dirname, 'e2e-estimate-output.html');
          writeFileSync(outPath, htmlRes.data, 'utf8');
          log('estimate-html', 'OK', { saved: outPath });
          results.ok.push('estimate-html');
        } else {
          log('estimate-html', 'FAIL', { status: htmlRes.status });
          results.fail.push({ step: 'estimate-html', error: htmlRes.data });
        }
      }
    }

    // 5. Housecall export dry-run (no live API call)
    if (selections?.length) {
      const exportBody = {
        user_id: USER_ID,
        selections,
        customer: { name: 'E2E Test Customer' },
        project: { summary: 'E2E test estimate' },
        housecall: { dry_run: true },
      };
      const exportRes = await request('POST', '/estimator/export/housecall', exportBody);
      if (!exportRes.ok) {
        log('export-housecall-dry-run', 'FAIL', { status: exportRes.status, body: exportRes.data });
        results.fail.push({ step: 'export-housecall-dry-run', error: exportRes.data });
      } else {
        const { dry_run, upsert_strategy, housecall_plan } = exportRes.data;
        log('export-housecall-dry-run', 'OK', {
          dry_run,
          upsert_strategy,
          plan_requests: housecall_plan?.length ?? 0,
        });
        results.ok.push('export-housecall-dry-run');
      }
    }
  }

  // Summary
  console.log('\n--- Summary ---');
  console.log(`Passed: ${results.ok.length}  Failed: ${results.fail.length}`);
  if (results.fail.length) {
    results.fail.forEach((f) => console.log(`  FAIL ${f.step}:`, f.error));
    process.exitCode = 1;
  }
  if (results.notes.length) {
    console.log('Notes:');
    results.notes.forEach((n) => console.log(`  ${n.step}: ${n.message}`));
  }
  console.log('');
}

main().catch((err) => {
  console.error(err.message || err);
  if (err?.cause?.code === 'ECONNREFUSED') {
    console.error('\nStart the bridge in another terminal: cd bridge && npm run dev (with bridge/.env or env secrets set)');
  }
  process.exit(1);
});

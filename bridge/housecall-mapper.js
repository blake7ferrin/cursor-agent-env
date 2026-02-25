function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function asTrimmedString(value, defaultValue = '') {
  if (value === undefined || value === null) return defaultValue;
  const str = `${value}`.trim();
  return str || defaultValue;
}

function compactObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if (Array.isArray(value)) {
      output[key] = value.map((item) => compactObject(item)).filter((item) => item !== undefined);
      continue;
    }
    output[key] = compactObject(value);
  }
  return output;
}

function buildDescription(line) {
  const parts = [];
  if (line.code) parts.push(`Code: ${line.code}`);
  if (line.notes) parts.push(line.notes);
  if (Array.isArray(line.features) && line.features.length) {
    parts.push(`Features: ${line.features.join(', ')}`);
  }
  return parts.join('\n');
}

function toHousecallLineItem(line, index) {
  const quantity = Number(line.quantity || 1);
  const safeQty = quantity > 0 ? quantity : 1;
  const unitPrice = roundMoney(Number(line?.costs?.targetSellPrice || 0) / safeQty);

  return compactObject({
    name: line.name || `Line item ${index + 1}`,
    description: buildDescription(line),
    quantity: safeQty,
    unit_price: unitPrice,
    taxable: line.taxable !== false,
    metadata: {
      source_item_type: line.itemType || '',
      source_cost_total: roundMoney(line?.costs?.totalCost || 0),
      source_labor_hours: Number(line.laborHours || 0),
    },
  });
}

function resolvePathTemplate(template, replacements) {
  const rawTemplate = asTrimmedString(template);
  if (!rawTemplate) throw new Error('Housecall endpoint template is required');

  const usedKeys = new Set();
  const resolved = rawTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    usedKeys.add(key);
    const value = replacements?.[key];
    const normalized = asTrimmedString(value);
    if (!normalized) {
      throw new Error(`Missing required value for endpoint template key: ${key}`);
    }
    return encodeURIComponent(normalized);
  });

  // Any remaining braces indicates malformed template.
  if (/\{[a-zA-Z0-9_]+\}/.test(resolved)) {
    throw new Error(`Failed to resolve endpoint template: ${rawTemplate}`);
  }
  return { path: resolved, template: rawTemplate, usedKeys: Array.from(usedKeys) };
}

function extractCustomerFromEstimate(estimate) {
  const customer = estimate?.customer || {};
  let firstName = customer.first_name || customer.firstName || '';
  let lastName = customer.last_name || customer.lastName || '';
  if ((!firstName || !lastName) && typeof customer.name === 'string' && customer.name.trim()) {
    const parts = customer.name.trim().split(/\s+/);
    firstName = firstName || parts[0] || '';
    lastName = lastName || (parts.length > 1 ? parts.slice(1).join(' ') : '');
  }
  return compactObject({
    id: customer.housecall_customer_id || customer.housecallCustomerId || customer.customer_id || customer.customerId,
    first_name: firstName,
    last_name: lastName,
    email: customer.email || '',
    phone_number: customer.phone || customer.phone_number || '',
    company: customer.company || '',
    address: customer.address || '',
  });
}

function extractHousecallContextFromEstimate(estimate = {}) {
  const project = estimate?.project || {};
  return {
    jobId: asTrimmedString(project.housecall_job_id || project.housecallJobId),
    estimateId: asTrimmedString(project.housecall_estimate_id || project.housecallEstimateId),
    estimateOptionId: asTrimmedString(
      project.housecall_estimate_option_id || project.housecallEstimateOptionId,
    ),
    appointmentId: asTrimmedString(project.housecall_appointment_id || project.housecallAppointmentId),
  };
}

function inferExportMode(options = {}, context = {}) {
  const normalizedMode = asTrimmedString(options.mode || '').toLowerCase();
  if (
    normalizedMode === 'create_estimate' ||
    normalizedMode === 'add_to_job' ||
    normalizedMode === 'update_estimate' ||
    normalizedMode === 'add_option_note'
  ) {
    return normalizedMode;
  }

  if (context.estimateOptionId && context.estimateId) return 'add_option_note';
  if (context.estimateId) return 'update_estimate';
  if (context.jobId) return 'add_to_job';
  return 'create_estimate';
}

export function buildHousecallEstimatePayload(estimate, options = {}) {
  if (!estimate || typeof estimate !== 'object') {
    throw new Error('estimate is required');
  }
  const lineItems = Array.isArray(estimate.line_items) ? estimate.line_items : [];
  if (!lineItems.length) {
    throw new Error('estimate.line_items must contain at least one item');
  }

  const mappedLineItems = lineItems.map((line, index) => toHousecallLineItem(line, index));
  const customer = extractCustomerFromEstimate(estimate);
  const optionName = options.optionName || estimate?.project?.summary || 'HVAC Estimate';
  const projectSummary = estimate?.project?.summary || 'HVAC estimate from pricing agent';
  const note = options.note || estimate?.project?.notes || '';
  const estimateTotal = roundMoney(estimate?.totals?.grandTotal || 0);
  const taxRate = Number(estimate?.totals?.taxRate || 0);
  const discountAmount = roundMoney(estimate?.totals?.discountTotal || 0);
  const customerDraft = compactObject({
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    phone_number: customer.phone_number,
    company: customer.company,
    address: customer.address,
  });
  const hasCustomerDraft = customerDraft && Object.keys(customerDraft).length > 0;

  const payload = compactObject({
    customer_id:
      options.customerId ||
      customer.id ||
      undefined,
    customer:
      options.customerId || customer.id
        ? undefined
        : hasCustomerDraft
          ? customerDraft
          : undefined,
    job_id: options.jobId || estimate?.project?.housecall_job_id || estimate?.project?.housecallJobId || undefined,
    name: optionName,
    note,
    message: projectSummary,
    tax_rate: taxRate,
    options: [
      {
        name: optionName,
        message: projectSummary,
        line_items: mappedLineItems,
      },
    ],
    ...(discountAmount > 0 ? { discount: { amount: discountAmount, type: 'fixed' } } : {}),
    metadata: {
      source: 'cursor-hvac-estimator',
      estimate_id: estimate.estimate_id,
      currency: estimate.currency || 'USD',
      grand_total: estimateTotal,
      achieved_margin: Number(estimate?.totals?.achievedGrossMargin || 0),
    },
  });

  return payload;
}

export function buildHousecallExportRequest(estimate, options = {}) {
  const estimateContext = extractHousecallContextFromEstimate(estimate);
  const context = {
    jobId: asTrimmedString(options.jobId || options.job_id || estimateContext.jobId),
    estimateId: asTrimmedString(options.estimateId || options.estimate_id || estimateContext.estimateId),
    estimateOptionId: asTrimmedString(
      options.estimateOptionId || options.estimate_option_id || estimateContext.estimateOptionId,
    ),
    appointmentId: asTrimmedString(
      options.appointmentId || options.appointment_id || estimateContext.appointmentId,
    ),
  };
  const mode = inferExportMode(options, context);

  const createEstimatePath =
    asTrimmedString(options.createEstimatePath || options.create_estimate_path) ||
    process.env.HOUSECALL_PRO_CREATE_ESTIMATE_PATH ||
    '/v1/estimates';
  const addToJobPath =
    asTrimmedString(options.addToJobPath || options.add_to_job_path) ||
    process.env.HOUSECALL_PRO_ADD_TO_JOB_ESTIMATE_PATH ||
    '/v1/jobs/{job_id}/estimates';
  const updateEstimatePath =
    asTrimmedString(options.updateEstimatePath || options.update_estimate_path) ||
    process.env.HOUSECALL_PRO_UPDATE_ESTIMATE_PATH ||
    '/v1/estimates/{estimate_id}';
  const addOptionNotePath =
    asTrimmedString(options.addOptionNotePath || options.add_option_note_path) ||
    process.env.HOUSECALL_PRO_ADD_OPTION_NOTE_PATH ||
    '/v1/estimates/{estimate_id}/options/{estimate_option_id}/notes';

  const hasPayloadOverride = options.payloadOverride && typeof options.payloadOverride === 'object';
  const basePayload = hasPayloadOverride ? options.payloadOverride : buildHousecallEstimatePayload(estimate, options);

  let endpointTemplate = createEstimatePath;
  let defaultMethod = 'POST';
  let payload = basePayload;

  if (mode === 'add_to_job') {
    if (!context.jobId) {
      throw new Error('job_id is required for Housecall mode=add_to_job');
    }
    endpointTemplate = addToJobPath;
    defaultMethod = 'POST';
  } else if (mode === 'update_estimate') {
    if (!context.estimateId) {
      throw new Error('estimate_id is required for Housecall mode=update_estimate');
    }
    endpointTemplate = updateEstimatePath;
    defaultMethod = 'PATCH';
  } else if (mode === 'add_option_note') {
    if (!context.estimateId || !context.estimateOptionId) {
      throw new Error('estimate_id and estimate_option_id are required for Housecall mode=add_option_note');
    }
    endpointTemplate = addOptionNotePath;
    defaultMethod = 'POST';
    payload =
      hasPayloadOverride && payload
        ? payload
        : compactObject({
            note: options.note || estimate?.project?.notes || '',
            metadata: {
              source: 'cursor-hvac-estimator',
              estimate_id: estimate?.estimate_id,
            },
          });
  }

  const endpoint = asTrimmedString(options.endpoint);
  const resolvedEndpoint = endpoint
    ? { path: endpoint, template: endpoint, usedKeys: [] }
    : resolvePathTemplate(endpointTemplate, {
        job_id: context.jobId,
        estimate_id: context.estimateId,
        estimate_option_id: context.estimateOptionId,
        appointment_id: context.appointmentId,
      });

  const method = `${options.method || defaultMethod}`.toUpperCase();

  return {
    mode,
    context,
    method,
    path: resolvedEndpoint.path,
    path_template: resolvedEndpoint.template,
    payload,
  };
}

export function buildHousecallAppointmentLookupRequest(options = {}) {
  const appointmentId = asTrimmedString(options.appointmentId || options.appointment_id);
  if (!appointmentId) {
    throw new Error('appointment_id is required for appointment lookup');
  }

  const template =
    asTrimmedString(options.appointmentLookupPath || options.appointment_lookup_path) ||
    process.env.HOUSECALL_PRO_APPOINTMENT_LOOKUP_PATH;
  if (!template) {
    throw new Error(
      'appointment_lookup_path is required (or set HOUSECALL_PRO_APPOINTMENT_LOOKUP_PATH) for appointment-based context resolution',
    );
  }

  const resolved = resolvePathTemplate(template, { appointment_id: appointmentId });
  const method = `${options.appointmentLookupMethod || options.appointment_lookup_method || 'GET'}`.toUpperCase();

  return {
    method,
    path: resolved.path,
    path_template: resolved.template,
    query: options.appointment_lookup_query,
  };
}

export function extractHousecallIdsFromObject(value) {
  const result = {
    jobId: '',
    estimateId: '',
    estimateOptionId: '',
    appointmentId: '',
  };
  const keyMap = {
    jobId: ['job_id', 'jobId', 'job.id'],
    estimateId: ['estimate_id', 'estimateId', 'estimate.id'],
    estimateOptionId: ['estimate_option_id', 'estimateOptionId', 'option_id', 'optionId'],
    appointmentId: ['appointment_id', 'appointmentId', 'schedule_id', 'scheduleId', 'event_id', 'eventId'],
  };

  const visit = (node, path = []) => {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) visit(item, path);
      return;
    }

    for (const [key, rawValue] of Object.entries(node)) {
      const nextPath = [...path, key];
      const value = typeof rawValue === 'string' || typeof rawValue === 'number' ? `${rawValue}` : '';
      const lowerKey = key.toLowerCase();
      const joinedPath = nextPath.join('.').toLowerCase();

      for (const [targetKey, candidates] of Object.entries(keyMap)) {
        if (result[targetKey]) continue;
        if (!value.trim()) continue;
        if (
          candidates.some((candidate) => {
            const normalizedCandidate = candidate.toLowerCase();
            return (
              normalizedCandidate === lowerKey ||
              normalizedCandidate === joinedPath ||
              joinedPath.endsWith(`.${normalizedCandidate}`)
            );
          })
        ) {
          result[targetKey] = value.trim();
        }
      }

      if (rawValue && typeof rawValue === 'object') {
        visit(rawValue, nextPath);
      }
    }
  };

  visit(value);
  return result;
}

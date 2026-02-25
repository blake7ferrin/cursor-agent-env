function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
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
  const endpoint = options.endpoint || process.env.HOUSECALL_PRO_CREATE_ESTIMATE_PATH || '/v1/estimates';
  const method = `${options.method || 'POST'}`.toUpperCase();
  const payload = options.payloadOverride && typeof options.payloadOverride === 'object'
    ? options.payloadOverride
    : buildHousecallEstimatePayload(estimate, options);

  return {
    method,
    path: endpoint,
    payload,
  };
}

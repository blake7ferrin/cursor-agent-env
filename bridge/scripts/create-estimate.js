#!/usr/bin/env node
/**
 * Create an HVAC estimate in Housecall Pro.
 * Usage: node scripts/create-estimate.js [customerFirstName] [customerLastName]
 *
 * Default: Tony Stark, 5-ton M-series split heat pump, standard attic, 45% margin.
 * Env: HOUSECALL_PRO_ACCESS_TOKEN, HCP_ACCESS_TOKEN, or HCP_API_KEY
 */

import * as hcp from '../housecall-pro.js';

const CUSTOMER_FIRST = process.argv[2] || 'Tony';
const CUSTOMER_LAST = process.argv[3] || 'Stark';

// 45% margin bid: total cost $5,919.42 → price $10,763
// Line items (scaled to hit 45% margin)
const LINE_ITEMS = [
  {
    name: 'AC Pro M-Series Heat Pump – 5 Ton (14.3 SEER2)',
    description: 'Reliable heat pump comfort. 10-year parts and compressor warranty – NO registration required. Equipment only.',
    quantity: 1,
    unit_price: 6790,
  },
  {
    name: 'Split System Change-Out (4–5 Ton)',
    description: 'Remove and replace existing split system. Standard attic. Includes reconnection and base installation materials.',
    quantity: 1,
    unit_price: 3973,
  },
];

async function main() {
  console.log(`Creating estimate for ${CUSTOMER_FIRST} ${CUSTOMER_LAST}...`);
  console.log('Line items:');
  LINE_ITEMS.forEach((li, i) => console.log(`  ${i + 1}. ${li.name}: $${li.unit_price}`));
  console.log(`  Total: $${LINE_ITEMS.reduce((s, li) => s + li.quantity * li.unit_price, 0)}`);

  const customerId = await hcp.getOrCreateCustomer(CUSTOMER_FIRST, CUSTOMER_LAST);
  console.log(`Customer ID: ${customerId}`);

  const totalCents = Math.round(LINE_ITEMS.reduce((s, li) => s + li.quantity * li.unit_price, 0) * 100);
  const optionName = '5 Ton M-Series Split Heat Pump - Standard Attic';
  const estimatePayload = {
    customer_id: String(customerId),
    options: [
      {
        name: optionName,
        total_amount: totalCents,
        line_items: LINE_ITEMS.map((li) => ({
          name: li.name,
          description: li.description,
          quantity: li.quantity,
          unit_price: Math.round(li.unit_price * 100), // cents
        })),
      },
    ],
  };

  const estimate = await hcp.createEstimate(estimatePayload);
  console.log('Estimate created:', JSON.stringify(estimate, null, 2));
  return estimate;
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});

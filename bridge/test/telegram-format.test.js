import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReplyForTelegram } from '../telegram-format.js';

test('formatReplyForTelegram converts markdown table to bullet lines', () => {
  const input = [
    '| Code | Description | Qty | Price |',
    '|------|-------------|-----|-------|',
    '| HP-1 | Heat Pump   | 1   | 5000  |',
  ].join('\n');
  const { text, parse_mode } = formatReplyForTelegram(input);
  assert.equal(parse_mode, 'HTML');
  assert.ok(text.includes('•'));
  assert.ok(text.includes('HP-1'));
  assert.ok(text.includes('5000'));
  assert.ok(!text.includes('|'));
});

test('formatReplyForTelegram converts bold to HTML', () => {
  const { text, parse_mode } = formatReplyForTelegram('**Total:** $100');
  assert.equal(parse_mode, 'HTML');
  assert.ok(text.includes('<b>'));
  assert.ok(text.includes('</b>'));
});

test('formatReplyForTelegram escapes HTML in content', () => {
  const { text } = formatReplyForTelegram('Cost < $100 & free');
  assert.ok(text.includes('&lt;'));
  assert.ok(text.includes('&amp;'));
});

test('formatReplyForTelegram truncates long content', () => {
  const long = 'a'.repeat(5000);
  const { text } = formatReplyForTelegram(long);
  assert.ok(text.length <= 4080);
  assert.ok(text.endsWith('…'));
});

test('formatReplyForTelegram handles empty or null', () => {
  assert.deepEqual(formatReplyForTelegram(''), { text: '' });
  assert.deepEqual(formatReplyForTelegram(null), { text: '' });
});

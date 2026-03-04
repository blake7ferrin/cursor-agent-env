/**
 * Format agent reply for Telegram so markdown tables and emphasis render readably.
 * Telegram supports parse_mode: 'HTML' with <b>, <i>, <code>, <pre>. We convert
 * markdown-style content and escape HTML so long messages (e.g. estimates) look good.
 */

const MAX_LENGTH = 4080;

function escapeHtml(s) {
  if (s == null || typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert a markdown table row (cells separated by |) to a single line with bullets or spacing.
 * Header separator line (|---|---|) is skipped. Data rows become "• cell1 — cell2 — cell3".
 */
function formatTableLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return '';
  const cells = trimmed
    .split(/\|/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (cells.length === 0) return '';
  if (cells.length === 1) return cells[0];
  if (/^[-:\s]+$/.test(cells.join(''))) return ''; // separator row
  return '• ' + cells.join(' — ');
}

function isTableRow(line) {
  const t = line.trim();
  if (!t || t.length < 2) return false;
  const pipeCount = (t.match(/\|/g) || []).length;
  return pipeCount >= 2;
}

/**
 * Convert **bold** and *italic* to HTML tags. Avoid matching across newlines.
 */
function markdownToHtml(text) {
  let out = text;
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  out = out.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  out = out.replace(/__([^_]+)__/g, '<b>$1</b>');
  out = out.replace(/_([^_]+)_/g, '<i>$1</i>');
  return out;
}

/**
 * Format agent reply for Telegram: convert tables to readable lines, apply HTML formatting, escape, truncate.
 * @param {string} content - Raw agent message (may contain markdown)
 * @returns {{ text: string, parse_mode?: 'HTML' }}
 */
export function formatReplyForTelegram(content) {
  if (content == null || typeof content !== 'string') {
    return { text: '' };
  }
  let text = content.trim();
  if (!text) return { text: '' };

  const lines = text.split(/\r?\n/);
  const out = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const thisIsTable = isTableRow(line);

    if (thisIsTable) {
      const formatted = formatTableLine(line);
      if (formatted) {
        if (!inTable) inTable = true;
        out.push(formatted);
      }
      continue;
    }
    inTable = false;

    if (line.trim() === '') {
      out.push('');
      continue;
    }

    out.push(line);
  }

  text = out.join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = escapeHtml(text);
  text = markdownToHtml(text);
  if (text.length > MAX_LENGTH) {
    text = text.slice(0, MAX_LENGTH - 3) + '…';
  }
  text = text.trim();
  if (!text) return { text: '(No content)' };

  return { text, parse_mode: 'HTML' };
}

import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const MAX_HEADER_BYTES = 64 * 1024;

export class PayoutHeaderError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PayoutHeaderError';
    this.code = code;
  }
}

/** Parse only the first CSV record. The returned labels must stay local. */
export function parsePayoutHeader(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Buffer required');
  if (bytes.length === 0) throw new PayoutHeaderError('EMPTY_FILE');
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    throw new PayoutHeaderError('NON_CSV_OFFICE_FORMAT');
  }
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PayoutHeaderError('NOT_UTF8');
  }
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  if (content.includes('\0')) throw new PayoutHeaderError('BINARY_CONTENT');
  const headers = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let fieldStarted = false;
  let terminated = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quoted) {
      if (c === '"' && content[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else { field += c; }
      continue;
    }
    if (c === ',' || c === '\r' || c === '\n') {
      headers.push(field);
      field = '';
      fieldStarted = false;
      afterQuote = false;
      if (c !== ',') { terminated = true; break; }
    } else if (c === '"' && !fieldStarted && !afterQuote) {
      quoted = true;
      fieldStarted = true;
    } else if (c === '"' || afterQuote) {
      throw new PayoutHeaderError('MALFORMED_CSV_HEADER');
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  if (quoted) throw new PayoutHeaderError('UNTERMINATED_QUOTED_HEADER');
  if (!terminated) {
    if (bytes.length > MAX_HEADER_BYTES) throw new PayoutHeaderError('HEADER_TOO_LARGE');
    headers.push(field);
  }
  if (headers.length < 2) throw new PayoutHeaderError('TOO_FEW_COLUMNS');
  const normalized = headers.map(x => x.trim());
  if (normalized.some(x => !x || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x))) {
    throw new PayoutHeaderError('INVALID_COLUMN_NAME');
  }
  if (new Set(normalized).size !== normalized.length) throw new PayoutHeaderError('DUPLICATE_COLUMN_NAMES');
  return {
    headers,
    columnCount: headers.length,
    headerFingerprint: createHash('sha256').update(JSON.stringify(headers)).digest('hex')
  };
}

async function inspectOne(path) {
  const handle = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(MAX_HEADER_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return parsePayoutHeader(bytes.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** Never returns data rows, filenames, or proof of payout/ledger compatibility. */
export async function inspectPayoutHeaders(reservationsPath, passesPath) {
  if (!reservationsPath || !passesPath || resolve(reservationsPath) === resolve(passesPath)) {
    throw new PayoutHeaderError('TWO_DISTINCT_FILES_REQUIRED');
  }
  const reservations = await inspectOne(reservationsPath);
  const passes = await inspectOne(passesPath);
  return {
    state: 'HEADERS_OBSERVED_MANUAL_REVIEW_REQUIRED',
    exports: [
      { role: 'payout_reservations', ...reservations },
      { role: 'payout_passes_subscriptions', ...passes }
    ],
    sourceProvenanceVerified: false,
    payoutJoinVerified: false,
    bankReconciliationVerified: false,
    mfImportVerified: false,
    realCsvCompatibilityVerified: false
  };
}

import { open, lstat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve } from 'node:path';

const MAX_BYTES = 16 * 1024 * 1024;

export class PayoutKeyPreflightError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// This is a local, opt-in research preflight, NOT a parser for a known STORES
// export format. It intentionally never returns identifiers or row contents.
function parseCsv(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new PayoutKeyPreflightError('NOT_UTF8'); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes('\0')) throw new PayoutKeyPreflightError('BINARY_CONTENT');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false, fieldStarted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else field += ch;
      continue;
    }
    if (ch === '"') {
      if (fieldStarted || closed) throw new PayoutKeyPreflightError('MALFORMED_CSV');
      quoted = true; fieldStarted = true;
    } else if (ch === ',') {
      row.push(field); field = ''; closed = false; fieldStarted = false;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = []; field = ''; closed = false; fieldStarted = false;
    } else {
      if (closed) throw new PayoutKeyPreflightError('MALFORMED_CSV');
      field += ch; fieldStarted = true;
    }
  }
  if (quoted) throw new PayoutKeyPreflightError('UNTERMINATED_QUOTED_FIELD');
  if (fieldStarted || closed || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) throw new PayoutKeyPreflightError('NO_DATA_ROWS');
  const headers = rows.shift();
  if (headers.length < 2 || headers.some(x => !x.trim()) || new Set(headers).size !== headers.length) {
    throw new PayoutKeyPreflightError('INVALID_HEADERS');
  }
  if (rows.some(r => r.length !== headers.length)) throw new PayoutKeyPreflightError('ROW_WIDTH_MISMATCH');
  return { headers, rows };
}

async function safeRead(path) {
  let before;
  try { before = await lstat(path); }
  catch { throw new PayoutKeyPreflightError('FILE_UNAVAILABLE'); }
  if (!before.isFile()) throw new PayoutKeyPreflightError('UNSAFE_FILE_TYPE');
  if (before.size > MAX_BYTES) throw new PayoutKeyPreflightError('FILE_TOO_LARGE');
  let handle;
  try { handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)); }
  catch { throw new PayoutKeyPreflightError('FILE_UNAVAILABLE_OR_UNSAFE'); }
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) {
      throw new PayoutKeyPreflightError('UNSAFE_FILE_TYPE');
    }
    if (after.size > MAX_BYTES) throw new PayoutKeyPreflightError('FILE_TOO_LARGE');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_BYTES) throw new PayoutKeyPreflightError('FILE_TOO_LARGE');
    return bytes;
  } finally { await handle.close(); }
}

function keysFromCsv(bytes, column) {
  const { headers, rows } = parseCsv(bytes);
  const index = headers.indexOf(column);
  if (index < 0) throw new PayoutKeyPreflightError('KEY_COLUMN_NOT_FOUND');
  if (rows.some(row => !row[index].trim())) throw new PayoutKeyPreflightError('EMPTY_PAYOUT_KEY');
  return { rowCount: rows.length, keys: new Set(rows.map(row => row[index])) };
}

/** Two-payout key discrimination preflight, without provenance/semantics claims. */
export async function inspectPayoutKeyCandidates(reservationsPath, passesPath, reservationsKey, passesKey) {
  if (![reservationsPath, passesPath, reservationsKey, passesKey].every(x => typeof x === 'string' && x.length)) {
    throw new PayoutKeyPreflightError('FOUR_ARGUMENTS_REQUIRED');
  }
  if (resolve(reservationsPath) === resolve(passesPath)) throw new PayoutKeyPreflightError('TWO_DISTINCT_FILES_REQUIRED');
  const [first, second] = await Promise.all([safeRead(reservationsPath), safeRead(passesPath)]);
  if (first.equals(second)) throw new PayoutKeyPreflightError('DUPLICATE_EXPORT_CONTENT');
  const a = keysFromCsv(first, reservationsKey);
  const b = keysFromCsv(second, passesKey);
  const shared = [...a.keys].filter(x => b.keys.has(x)).length;
  return {
    state: shared >= 2 ? 'TWO_SHARED_KEYS_OBSERVED_MANUAL_REVIEW_REQUIRED' : 'INSUFFICIENT_SHARED_KEYS',
    reservations: { rowCount: a.rowCount, distinctKeyCount: a.keys.size },
    passesSubscriptions: { rowCount: b.rowCount, distinctKeyCount: b.keys.size },
    sharedKeyCount: shared,
    onlyReservationsKeyCount: a.keys.size - shared,
    onlyPassesSubscriptionsKeyCount: b.keys.size - shared,
    // Even matching strings may refer to unrelated transfers in different exports.
    keySemanticsVerified: false,
    sourceProvenanceVerified: false,
    crossPayoutMisjoinRejected: false,
    bankReconciliationVerified: false,
    mfImportVerified: false,
    realCsvCompatibilityVerified: false
  };
}

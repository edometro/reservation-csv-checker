import { open, lstat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
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

// CSV delimiters and quotes are ASCII bytes in UTF-8. Find the first record
// before decoding: data rows can be truncated at the bounded-read limit and
// must not cause a header-only check to report a false UTF-8 failure.
function firstHeaderRecordEnd(bytes) {
  let quoted = false;
  let fieldStart = true;
  let afterQuote = false;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0x22) {
      if (quoted) {
        if (bytes[i + 1] === 0x22) i++;
        else { quoted = false; afterQuote = true; }
      } else if (fieldStart && !afterQuote) {
        quoted = true;
        fieldStart = false;
      }
    } else if (!quoted && (byte === 0x0a || byte === 0x0d)) {
      return i + 1;
    } else if (!quoted && byte === 0x2c) {
      fieldStart = true;
      afterQuote = false;
    } else if (!quoted) {
      fieldStart = false;
    }
  }
  return bytes.length;
}

/** Parse only the first CSV record. The returned labels must stay local. */
export function parsePayoutHeader(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Buffer required');
  if (bytes.length === 0) throw new PayoutHeaderError('EMPTY_FILE');
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    throw new PayoutHeaderError('NON_CSV_OFFICE_FORMAT');
  }
  const headerEnd = firstHeaderRecordEnd(bytes);
  if (headerEnd > MAX_HEADER_BYTES) throw new PayoutHeaderError('HEADER_TOO_LARGE');
  let content;
  try {
    // Validate the header only, never the unrelated data rows.
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, headerEnd));
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
  if (!terminated) headers.push(field);
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

// A path may point to a FIFO, device, directory, or symlink. Refuse those
// before reading sensitive CSVs. O_NOFOLLOW also closes the lstat/open race
// on platforms that support it; the inode check catches path substitution.
async function openRegularFile(path) {
  const before = await lstat(path);
  if (!before.isFile()) throw new PayoutHeaderError('UNSAFE_FILE_TYPE');
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (error?.code === 'ELOOP') throw new PayoutHeaderError('UNSAFE_FILE_TYPE');
    throw error;
  }
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) {
      throw new PayoutHeaderError('UNSAFE_FILE_TYPE');
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function inspectOne(handle) {
  const bytes = Buffer.alloc(MAX_HEADER_BYTES + 1);
  const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
  return parsePayoutHeader(bytes.subarray(0, bytesRead));
}

// Hash through the SAME open descriptor used for header inspection. Reopening
// a pathname would allow a replaced file to be hashed after a different header
// was checked. Hashes and file contents never leave this process.
async function digestFile(handle) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

/** Never returns data rows, filenames, or proof of payout/ledger compatibility. */
export async function inspectPayoutHeaders(reservationsPath, passesPath) {
  if (!reservationsPath || !passesPath || resolve(reservationsPath) === resolve(passesPath)) {
    throw new PayoutHeaderError('TWO_DISTINCT_FILES_REQUIRED');
  }
  const first = await openRegularFile(reservationsPath);
  try {
    const second = await openRegularFile(passesPath);
    try {
      const [firstStat, secondStat] = await Promise.all([first.stat(), second.stat()]);
      if (firstStat.dev === secondStat.dev && firstStat.ino === secondStat.ino) {
        throw new PayoutHeaderError('DUPLICATE_EXPORT_CONTENT');
      }
      const reservations = await inspectOne(first);
      const passes = await inspectOne(second);
      if (await digestFile(first) === await digestFile(second)) {
        throw new PayoutHeaderError('DUPLICATE_EXPORT_CONTENT');
      }
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
    } finally {
      await second.close();
    }
  } finally {
    await first.close();
  }
}

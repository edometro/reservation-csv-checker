/** Pure CSV and validation logic. User files are processed in the browser. */
export const MF_HEADERS = [
  '取引No','取引日','借方勘定科目','借方補助科目','借方部門','借方取引先',
  '借方税区分','借方インボイス','借方金額(円)','借方税額',
  '貸方勘定科目','貸方補助科目','貸方部門','貸方取引先',
  '貸方税区分','貸方インボイス','貸方金額(円)','貸方税額',
  '摘要','仕訳メモ','タグ','MF仕訳タイプ',
  '決算整理仕訳','作成日時','作成者','最終更新日時','最終更新者'
];

// These STORES reservation-list dates do not establish a payment/ledger transaction date.
// Never silently promote application, booking, or visit timestamps to journal candidates.
const UNVERIFIED_TRANSACTION_DATE_COLUMNS = new Set([
  '申込日時', '予約日時', '希望の予約日時', '来客日時',
  '来客／キャンセル日時', '来客/キャンセル日時', 'キャンセル日時', '購入日時'
]);

// STORES予約 lists reservation status and payment status separately.
// Never infer the payment state from a generic "ステータス" column.
export const COLUMN_SUGGESTIONS = Object.freeze({
  id: ['予約ID','取引ID','オーダー番号','注文ID','予約番号'],
  date: ['決済日','支払日','入金日','取引日'],
  amount: ['決済金額','金額','売上金額','支払金額','決済額'],
  status: ['支払ステータス','支払いステータス','決済状況','支払状況','決済ステータス'],
  bookingStatus: ['予約ステータス','予約状況','ステータス','予約のステータス'],
  description: ['メニュー','商品名','摘要','予約メニュー']
});

export function suggestColumns(headers) {
  return Object.fromEntries(Object.entries(COLUMN_SUGGESTIONS).map(([field, names]) =>
    [field, names.find(name => headers.includes(name)) ?? '']));
}

// Guard untrusted input before building a potentially huge row/column structure.
// The generic parser keeps unlimited defaults for trusted, generated CSV output.
export const MAX_INPUT_ROWS = 50000;
export const MAX_INPUT_COLUMNS = 200;

export function parseCSV(input, {maxRows = Infinity, maxColumns = Infinity, recordLines = null} = {}) {
  const csv = String(input).replace(/^\uFEFF/, '');
  const rows = [];
  let record = [], cell = '', inQuotes = false, afterQuote = false;
  let physicalLine = 1, recordStartLine = 1;
  function pushCell() {
    record.push(cell);
    if (record.length > maxColumns) throw new Error('CSVの列数上限を超えました');
    cell = ''; afterQuote = false;
  }
  function pushRecord() {
    pushCell();
    if (!(record.length === 1 && record[0] === '')) {
      if (rows.length >= maxRows) throw new Error('CSVの行数上限を超えました');
      rows.push(record);
      if (recordLines) recordLines.push(recordStartLine);
    }
    record = [];
  }
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQuotes = false; afterQuote = true; }
      else {
        cell += c;
        // Quoted fields may contain physical line breaks (CR, LF or CRLF).
        if (c === '\r' || (c === '\n' && csv[i - 1] !== '\r')) physicalLine++;
      }
    } else if (c === ',') {
      pushCell();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      pushRecord();
      physicalLine++;
      recordStartLine = physicalLine;
    } else if (afterQuote) {
      throw new Error('CSV書式エラー: 閉じ引用符の直後に不正な文字');
    } else if (c === '"') {
      if (cell !== '') throw new Error(`CSV書式エラー: ${rows.length + 1}行目の引用符`);
      inQuotes = true;
    } else cell += c;
  }
  if (inQuotes) throw new Error('CSV書式エラー: 閉じられていない引用符');
  pushRecord();
  if (!rows.length) throw new Error('CSVファイルが空です');
  const width = rows[0].length;
  if (rows.some((row, idx) => idx > 0 && row.length !== width)) throw new Error('CSVの列数が行ごとに異なります');
  return rows;
}

export function stringifyCSV(rows) {
  return rows.map(row => row.map(value => {
    let s = String(value ?? '');
    if (/[",\r\n]/.test(s)) s = '"' + s.replaceAll('"', '""') + '"';
    return s;
  }).join(',')).join('\r\n') + '\r\n';
}

// Physical CSV row metadata must not occupy a user-controlled column name (e.g. '__line').
const SOURCE_LINE = Symbol('csvPhysicalLine');

export function objectRows(csvText) {
  const recordLines = [];
  const [header, ...records] = parseCSV(csvText, {
    maxRows: MAX_INPUT_ROWS + 1, // includes header
    maxColumns: MAX_INPUT_COLUMNS,
    recordLines
  });
  const keys = header.map(x => x.trim());
  if (keys.some(x => !x) || new Set(keys).size !== keys.length) {
    throw new Error('ヘッダーが空欄、または重複しています');
  }
  return {headers: keys, rows: records.map((record, idx) => {
    const row = Object.fromEntries(keys.map((key, i) => [key, record[i]]));
    Object.defineProperty(row, SOURCE_LINE, {value: recordLines[idx + 1]});
    return row;
  })};
}

export function normalizeDate(value) {
  const s = String(value ?? '').trim();
  // Reject arbitrary trailing text rather than silently converting it into a transaction date.
  const m = /^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})(?:日)?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], day = +m[3];
  if (m[4] !== undefined && (+m[4] > 23 || +m[5] > 59 || (m[6] !== undefined && +m[6] > 59))) return null;
  const d = new Date(Date.UTC(y, mo - 1, day));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) return null;
  return [y, String(mo).padStart(2,'0'), String(day).padStart(2,'0')].join('/');
}

export function parseYen(value) {
  const s = String(value ?? '').trim();
  // Only accept plain integer yen or correctly grouped thousands separators.
  // Removing commas/spaces unconditionally can turn malformed source data into a wrong amount.
  const m = /^(?:[¥￥]\s*)?(\d+|\d{1,3}(?:,\d{3})+)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replaceAll(',', ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const PAID = new Set(['paid','payment completed','支払済','支払い済み','決済済','決済完了','入金済','入金済み']);
const REVIEW = /キャンセル|cancel|返金|refund|未払|未決済|支払待|現地|未収/i;
const BOOKING_REVIEW = /キャンセル|取消|取り消|中止|無効|cancel|refund/i;
// STORES documents 確定 / キャンセル / 承認待ち as reservation statuses.
// Fail closed for unconfirmed or unknown statuses even when payment is marked paid.
// Other service-specific statuses need explicit validation against real CSV samples.
const BOOKING_CONFIRMED = new Set(['確定', '予約確定', 'confirmed']);
function excelSafe(s) {
  const v = String(s ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

/** Generate review-only candidates, not final accounting decisions. */
export function analyze(rows, mapping, priorKeys = new Set()) {
  const idKey = mapping.id, dateKey = mapping.date, amountKey = mapping.amount, statusKey = mapping.status;
  const bookingStatusKey = mapping.bookingStatus;
  const dateSourceNeedsReview = UNVERIFIED_TRANSACTION_DATE_COLUMNS.has(String(dateKey ?? '').trim());
  if (bookingStatusKey && [idKey,dateKey,amountKey,statusKey].includes(bookingStatusKey)) {
    throw new Error('予約ステータスには他の必須項目と別の列を指定してください');
  }
  const bookingHeaderPresent = !bookingStatusKey && rows.some(row =>
    COLUMN_SUGGESTIONS.bookingStatus.some(header =>
      Object.prototype.hasOwnProperty.call(row, header) && header !== statusKey));
  if (![idKey,dateKey,amountKey,statusKey].every(Boolean)) throw new Error('4つの必須列を指定してください');
  // Validate here too, not only in the UI: callers may use analyze() directly.
  // Reusing one CSV column for different financial fields can produce plausible but wrong journal candidates.
  if (new Set([idKey,dateKey,amountKey,statusKey]).size !== 4) {
    throw new Error('異なる4つの必須列を指定してください');
  }
  const frequencies = new Map();
  for (const source of rows) {
    const id = String(source[idKey] ?? '').trim();
    if (id) frequencies.set(id, (frequencies.get(id) ?? 0) + 1);
  }
  return rows.map((source, i) => {
    const rawId = String(source[idKey] ?? '');
    const id = rawId.trim();
    const date = normalizeDate(source[dateKey]);
    const amount = parseYen(source[amountKey]);
    const status = String(source[statusKey] ?? '').trim();
    const bookingStatus = bookingStatusKey ? String(source[bookingStatusKey] ?? '').trim() : '';
    const flags = [];
    if (!id) flags.push('取引IDなし');
    // Trimming changes the reconciliation key; quarantine rather than silently rewriting it.
    if (rawId !== id) flags.push('取引IDの前後に空白があります（元IDと照合キーが異なります）');
    // Do not silently rewrite identifiers containing tabs, line breaks, NUL, etc.
    // Such IDs would change in the spreadsheet-safe report/export and evade exact matching.
    if (/[\u0000-\u001F\u007F]/.test(rawId)) flags.push('取引IDに制御文字が含まれます');
    if (!date) flags.push('日付形式エラー');
    if (dateSourceNeedsReview) flags.push('予約・申込・来客・購入日時を会計取引日とする根拠が未確認');
    if (amount == null) flags.push('金額形式エラーまたは0円');
    if (!status) flags.push('支払状況が空欄');
    else if (REVIEW.test(status)) flags.push('キャンセル・返金・未決済等の確認が必要');
    else if (!PAID.has(status.toLowerCase())) flags.push('支払済みと判定できない状態');
    if (bookingHeaderPresent) flags.push('予約ステータス列が存在しますが未指定です');
    if (bookingStatusKey && !bookingStatus) flags.push('予約ステータスが空欄');
    else if (bookingStatusKey && BOOKING_REVIEW.test(bookingStatus)) flags.push('予約キャンセル・取消等の確認が必要');
    else if (bookingStatusKey && !BOOKING_CONFIRMED.has(bookingStatus.toLowerCase())) {
      flags.push('予約未確定または未確認のステータス（承認待ち等）');
    }
    if (id && frequencies.get(id) > 1) flags.push('ファイル内の取引ID重複');
    if (id && priorKeys.has(id)) flags.push('過去出力との取引ID重複（参考）');
    return {line: source[SOURCE_LINE] ?? i+2, id, date, amount, status, bookingStatus, flags,
      description: excelSafe(mapping.description ? source[mapping.description] : ''),
      ready: flags.length === 0};
  });
}

export function ledgerCSV(analysis, debit, credit, confirmation) {
  if (!confirmation) throw new Error('内容の確認と仕訳方針の承認が必要です');
  const d = String(debit ?? '').trim(), c = String(credit ?? '').trim();
  if (!d || !c || d.length > 30 || c.length > 30) throw new Error('借方・貸方勘定科目を1〜30文字で指定してください');
  if (/^[=+\-@]/.test(d) || /^[=+\-@]/.test(c) || /[\r\n]/.test(d+c)) throw new Error('勘定科目の形式が不正です');
  const ready = analysis.filter(row => row.ready);
  if (!ready.length) throw new Error('出力可能な候補がありません');
  const content = ready.map(row => {
    const r = Array(MF_HEADERS.length).fill('');
    r[1] = row.date;
    r[2] = d;
    r[8] = row.amount;
    r[10] = c;
    r[16] = row.amount;
    const description = excelSafe(`予約 ${row.id} ${row.description}`);
    // Never silently truncate a transaction ID or user text. Truncation used to
    // hide an overlong description from the preflight audit, and could split emoji.
    if (Array.from(description).length > 200) {
      throw new Error(`元CSV${row.line}行目: 摘要は200文字以内にしてください（元データの修正が必要です）`);
    }
    r[18] = description;
    return r;
  });
  return stringifyCSV([MF_HEADERS, ...content]);
}

export function reportCSV(analysis) {
  return stringifyCSV([['元CSV行','取引ID','取引日','金額','支払状況','予約状況','判定','理由'], ...analysis.map(r => [
    r.line, excelSafe(r.id), r.date ?? '', r.amount ?? '', excelSafe(r.status), excelSafe(r.bookingStatus), r.ready ? '候補' : '要確認', r.flags.join(' / ')
  ])]);
}

export function priorIdSet(csvText, idHeader) {
  const {headers, rows} = objectRows(csvText);
  if (!headers.includes(idHeader)) throw new Error('過去ファイルに指定した取引ID列がありません');
  return new Set(rows.map(r => String(r[idHeader] ?? '').trim()).filter(Boolean));
}

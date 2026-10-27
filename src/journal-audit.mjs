import {MF_HEADERS, MAX_INPUT_ROWS, normalizeDate, parseCSV, parseYen} from './core.mjs';

/**
 * Structural preflight for Money Forward journal *candidates*.
 * Passing this audit does NOT establish the correctness of tax treatment,
 * recognition timing, account names, or the absence of prior imports.
 */
export function auditJournalCSV(csvText, {fiscalYearStart = '', fiscalYearEnd = '', targetMonth = ''} = {}) {
  let parsed;
  // Preserve physical CSV line numbers even when quoted fields contain newlines.
  const recordLines = [];
  try {
    parsed = parseCSV(csvText, {maxRows: MAX_INPUT_ROWS + 1, maxColumns: MF_HEADERS.length, recordLines});
  } catch (error) {
    return {rowCount: 0, errors: [`CSV解析エラー: ${error.message}`], warnings: []};
  }

  const [header, ...rows] = parsed;
  const errors = [];
  const warnings = [];
  if (header.length !== MF_HEADERS.length || header.some((name, i) => name !== MF_HEADERS[i])) {
    return {rowCount: rows.length, errors: ['マネーフォワード仕訳帳の27列ヘッダーと一致しません'], warnings};
  }
  if (!rows.length) errors.push('仕訳候補がありません');

  // MF imports only into the accounting year currently selected in the account.
  // This optional user-supplied range cannot establish the correct recognition date.
  let fiscalRange = null;
  if (fiscalYearStart || fiscalYearEnd) {
    if (!fiscalYearStart || !fiscalYearEnd) {
      errors.push('会計年度の開始日と終了日を両方指定してください');
    } else {
      const validFormat = /^\d{4}-\d{2}-\d{2}$/;
      const start = validFormat.test(fiscalYearStart) ? normalizeDate(fiscalYearStart) : null;
      const end = validFormat.test(fiscalYearEnd) ? normalizeDate(fiscalYearEnd) : null;
      if (!start || !end || start > end) {
        errors.push('会計年度の期間が不正です（有効な開始日・終了日を順に指定してください）');
      } else {
        fiscalRange = {start, end};
      }
    }
  }

  // STORES reservation exports can span several months by default. An optional
  // explicitly selected accounting month prevents out-of-period journal imports.
  // This checks the chosen transaction-date column, NOT the booking date or
  // whether the transaction date is correct for revenue recognition.
  let targetMonthPrefix = null;
  if (targetMonth !== '') {
    if (typeof targetMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) {
      errors.push('対象月はYYYY-MM形式で指定してください');
    } else {
      targetMonthPrefix = targetMonth.replace('-', '/') + '/';
    }
  }

  let missingTax = 0, missingNumber = 0;
  const seenEntries = new Map();
  rows.forEach((row, index) => {
    const line = recordLines[index + 1];
    // CSV quoting is not spreadsheet formula escaping. Fail closed even when
    // an optional column contains a formula-like value: users may inspect or
    // edit this CSV in spreadsheet software before importing it.
    row.forEach((value, col) => {
      if (/^[\u0000-\u001F\u007F\s]*[=+\-@]/u.test(value)) {
        errors.push(`${line}行目: ${MF_HEADERS[col]}に数式として解釈される可能性のある値があります`);
      }
    });
    // Money Forward imports every row as a new entry. Reject exact duplicates
    // within one export; matching amounts alone may be legitimate transactions.
    const entryKey = JSON.stringify(row);
    if (seenEntries.has(entryKey)) {
      errors.push(`${line}行目: ${seenEntries.get(entryKey)}行目と完全に同一の仕訳行が重複しています（二重取り込みリスク）`);
    } else {
      seenEntries.set(entryKey, line);
    }
    if (normalizeDate(row[1]) !== row[1]) {
      errors.push(`${line}行目: 取引日がyyyy/MM/dd形式ではありません`);
    } else {
      if (fiscalRange && (row[1] < fiscalRange.start || row[1] > fiscalRange.end)) {
        errors.push(`${line}行目: 取引日が指定した会計年度（${fiscalRange.start}〜${fiscalRange.end}）の範囲外です`);
      }
      if (targetMonthPrefix && !row[1].startsWith(targetMonthPrefix)) {
        errors.push(`${line}行目: 取引日が指定した対象月（${targetMonth}）の範囲外です`);
      }
    }
    for (const col of [2, 10]) {
      const account = row[col].trim();
      if (!account || account.length > 30 || /^[=+\-@]/.test(account) || /[\r\n]/.test(account)) {
        errors.push(`${line}行目: ${MF_HEADERS[col]}が不正です`);
      }
    }
    // Official MF journal import accepts only an empty cell or the literal 0
    // for both tax-amount columns; positive tax figures are not imported here.
    for (const col of [9, 17]) {
      if (row[col] !== '' && row[col] !== '0') {
        errors.push(`${line}行目: ${MF_HEADERS[col]}は空欄または0のみ指定できます`);
      }
    }
    const debit = parseYen(row[8]), credit = parseYen(row[16]);
    if (debit === null || credit === null || debit !== credit) {
      errors.push(`${line}行目: 借方・貸方金額が不正、または一致しません`);
    }
    // MF permits an empty transaction number, but a supplied one must be
    // 1-9 ASCII digits. Repeated numbers may intentionally form a compound entry.
    const transactionNumber = row[0].trim();
    if (transactionNumber && !/^[0-9]{1,9}$/.test(transactionNumber)) {
      errors.push(`${line}行目: 取引Noは9桁以内の数字で指定してください`);
    }
    // The official import guide limits 摘要 to 200 characters.
    if (Array.from(row[18]).length > 200) {
      errors.push(`${line}行目: 摘要は200文字以内で指定してください`);
    }
    if (!row[6].trim() || !row[14].trim()) missingTax++;
    if (!transactionNumber) missingNumber++;
  });

  if (missingTax) warnings.push(`借方または貸方の税区分が未設定: ${missingTax}件（会計・税務上の判断が必要）`);
  if (missingNumber) warnings.push(`取引Noが未設定: ${missingNumber}件（会計側の二重取り込みを防止できません）`);
  // Even a populated transaction number is NOT an idempotency key: MF assigns
  // a new number if it already exists and imports the journal again.
  if (rows.length) warnings.push('再インポートすると取引Noの指定・再利用に関係なく新規仕訳が登録されます（会計側の登録履歴を確認してください）');
  return {rowCount: rows.length, errors, warnings};
}

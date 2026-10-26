import {MF_HEADERS, MAX_INPUT_ROWS, normalizeDate, parseCSV, parseYen} from './core.mjs';

/**
 * Structural preflight for Money Forward journal *candidates*.
 * Passing this audit does NOT establish the correctness of tax treatment,
 * recognition timing, account names, or the absence of prior imports.
 */
export function auditJournalCSV(csvText) {
  let parsed;
  try {
    parsed = parseCSV(csvText, {maxRows: MAX_INPUT_ROWS + 1, maxColumns: MF_HEADERS.length});
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

  let missingTax = 0, missingNumber = 0;
  const seenEntries = new Map();
  rows.forEach((row, index) => {
    const line = index + 2;
    // Money Forward imports every row as a new entry. Reject exact duplicates
    // within one export; matching amounts alone may be legitimate transactions.
    const entryKey = JSON.stringify(row);
    if (seenEntries.has(entryKey)) {
      errors.push(`${line}行目: ${seenEntries.get(entryKey)}行目と完全に同一の仕訳行が重複しています（二重取り込みリスク）`);
    } else {
      seenEntries.set(entryKey, line);
    }
    if (normalizeDate(row[1]) !== row[1]) errors.push(`${line}行目: 取引日がyyyy/MM/dd形式ではありません`);
    for (const col of [2, 10]) {
      const account = row[col].trim();
      if (!account || account.length > 30 || /^[=+\-@]/.test(account) || /[\r\n]/.test(account)) {
        errors.push(`${line}行目: ${MF_HEADERS[col]}が不正です`);
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
  return {rowCount: rows.length, errors, warnings};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, ledgerCSV, MF_HEADERS, objectRows, parseCSV, stringifyCSV} from '../src/core.mjs';
import {auditJournalCSV} from '../src/journal-audit.mjs';

const mapping={id:'取引ID',date:'決済日',amount:'金額',status:'支払状況'};
const data=analyze(objectRows('取引ID,決済日,金額,支払状況\\nT1,2026/10/26,1200,決済済').rows,mapping);
const draft=()=>ledgerCSV(data,'普通預金','売上高',true);

test('generated journal has valid structure but unverified tax and duplicate-import warnings',()=>{
  const audit=auditJournalCSV(draft());
  assert.equal(audit.rowCount,1);
  assert.deepEqual(audit.errors,[]);
  assert.equal(audit.warnings.length,2);
  assert.match(audit.warnings.join(' '),/税区分が未設定/);
  assert.match(audit.warnings.join(' '),/取引Noが未設定/);
});

test('journal preflight catches date, account and unbalanced amounts',()=>{
  const rows=parseCSV(draft());
  rows[1][1]='2026/02/30';
  rows[1][2]='=HYPERLINK(1)';
  rows[1][16]='999';
  const audit=auditJournalCSV(stringifyCSV(rows));
  assert.match(audit.errors.join(' '),/取引日/);
  assert.match(audit.errors.join(' '),/借方勘定科目/);
  assert.match(audit.errors.join(' '),/借方・貸方金額/);
});

test('journal preflight rejects wrong schema, empty journals and malformed CSV safely',()=>{
  const rows=parseCSV(draft());
  rows[0][1]='予約日時';
  assert.match(auditJournalCSV(stringifyCSV(rows)).errors.join(' '),/27列ヘッダー/);
  assert.match(auditJournalCSV(stringifyCSV([MF_HEADERS])).errors.join(' '),/仕訳候補がありません/);
  assert.match(auditJournalCSV('a,b\\n"x"junk,y').errors.join(' '),/CSV解析エラー/);
  assert.match(auditJournalCSV('a,b\\nc,d').errors.join(' '),/27列ヘッダー/);
});

test('preflight warns only for missing tax classifications and transaction numbers',()=>{
  const rows=parseCSV(draft());
  rows[1][0]='T1';
  rows[1][6]='仮の借方税区分';
  rows[1][14]='仮の貸方税区分';
  const audit=auditJournalCSV(stringifyCSV(rows));
  assert.deepEqual(audit.errors,[]);
  assert.deepEqual(audit.warnings,[]);
  // This is a structural check only: values may still be invalid in the actual accounting software.
});

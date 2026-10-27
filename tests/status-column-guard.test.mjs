import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, objectRows} from '../src/core.mjs';

test('manual mapping cannot turn unrelated paid/confirmed text into proof of payment and booking', () => {
  // Actual source columns say unpaid and cancelled, but unrelated text columns
  // happen to contain the words accepted by the analyzer.
  const {rows} = objectRows([
    '予約ID,決済日,決済金額,支払ステータス,ステータス,メニュー,備考',
    'B1,2026/10/27,1200,未決済,キャンセル,paid,確定'
  ].join('\n'));
  const mapping = {
    id: '予約ID', date: '決済日', amount: '決済金額',
    status: 'メニュー', bookingStatus: '備考'
  };
  assert.throws(() => analyze(rows, mapping), /支払ステータス列が存在/);
  assert.throws(
    () => analyze(rows, {...mapping, status: '支払ステータス'}),
    /予約ステータス列が存在/
  );
  const findings = analyze(rows, {
    ...mapping, status: '支払ステータス', bookingStatus: 'ステータス'
  });
  assert.equal(findings[0].ready, false);
  assert.match(findings[0].flags.join(' / '), /未決済/);
  assert.match(findings[0].flags.join(' / '), /予約キャンセル/);
});

test('known payment status cannot be ignored even when booking status is not mapped', () => {
  const {rows} = objectRows([
    '予約ID,決済日,決済金額,支払ステータス,メモ',
    'B2,2026/10/27,1500,未決済,paid'
  ].join('\n'));
  const base = {id:'予約ID', date:'決済日', amount:'決済金額', status:'メモ'};
  assert.throws(() => analyze(rows, base), /支払ステータス列が存在/);
  const findings = analyze(rows, {...base, status:'支払ステータス'});
  assert.equal(findings[0].ready, false);
});

test('generic CSVs without recognized status headers still allow explicit manual mapping', () => {
  const {rows} = objectRows([
    '取引ID,決済日,金額,支払状態,予約判定',
    'G1,2026/10/27,1500,paid,confirmed'
  ].join('\n'));
  const findings = analyze(rows, {
    id:'取引ID', date:'決済日', amount:'金額',
    status:'支払状態', bookingStatus:'予約判定'
  });
  assert.equal(findings[0].ready, true);
});

test('recognized booking header can be left unmapped only as review-only', () => {
  const {rows} = objectRows([
    '予約ID,決済日,決済金額,支払ステータス,ステータス',
    'B3,2026/10/27,1500,決済済,キャンセル'
  ].join('\n'));
  const findings = analyze(rows, {
    id:'予約ID', date:'決済日', amount:'決済金額', status:'支払ステータス'
  });
  assert.equal(findings[0].ready, false);
  assert.match(findings[0].flags.join(' / '), /予約ステータス列が存在しますが未指定/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, objectRows, suggestColumns, ledgerCSV, parseCSV} from '../src/core.mjs';

const csv = [
  '予約ID,決済日,金額,ステータス,支払ステータス',
  'A1,2026/10/01,1200,paid,返金済',
  'A2,2026/10/02,1500,確定,決済済'
].join('\n');
const rows = objectRows(csv).rows;
const base = {id:'予約ID',date:'決済日',amount:'金額'};

test('STORES generic booking status cannot be selected as proof of payment', () => {
  // The first booking-status value resembles a paid payment state,
  // but the separate payment column explicitly says it was refunded.
  assert.throws(
    () => analyze(rows, {...base,status:'ステータス',bookingStatus:'支払ステータス'}),
    /予約ステータスの列を支払ステータスとして指定できません/
  );
  assert.throws(
    () => analyze(rows, {...base,status:'ステータス'}),
    /予約ステータスの列を支払ステータスとして指定できません/
  );
});

test('explicit booking-status columns are never accepted as payment columns', () => {
  for (const name of ['予約ステータス','予約状況','予約のステータス','ステータス']) {
    const input = [{予約ID:'X',決済日:'2026/10/01',金額:'1000',[name]:'paid'}];
    assert.throws(() => analyze(input,{...base,status:name}),/予約ステータスの列/);
  }
});

test('correct payment and booking mapping still separates refunded and confirmed rows', () => {
  const mapping = {...base,status:'支払ステータス',bookingStatus:'ステータス'};
  assert.equal(suggestColumns(Object.keys(rows[0])).status,'支払ステータス');
  const findings = analyze(rows,mapping);
  assert.deepEqual(findings.map(row => row.ready),[false,true]);
  assert.match(findings[0].flags.join(' / '),/返金/);
  const journal = parseCSV(ledgerCSV(findings,'普通預金','売上高',true));
  assert.equal(journal.length,2);
  assert.match(journal[1][18],/A2/);
  assert.doesNotMatch(journal[1][18],/A1/);
});

test('unambiguous payment-status names remain usable', () => {
  const valid = [{予約ID:'X',決済日:'2026/10/01',金額:'1000',決済状況:'paid'}];
  assert.equal(analyze(valid,{...base,status:'決済状況'})[0].ready,true);
});

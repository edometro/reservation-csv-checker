import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, ledgerCSV, objectRows} from '../src/core.mjs';

const mapping = {
  id: '予約ID', date: '決済日', amount: '決済金額',
  status: '支払ステータス', bookingStatus: 'ステータス'
};

function rows(payment, alternatePayment, booking = '確定', alternateBooking = '確定') {
  return objectRows([
    '予約ID,決済日,決済金額,支払ステータス,決済状況,ステータス,予約状況',
    ['R1','2026/10/27','1200',payment,alternatePayment,booking,alternateBooking].join(',')
  ].join('\n')).rows;
}

function assertReviewOnly(sourceRows, reason) {
  const [finding] = analyze(sourceRows, mapping);
  assert.equal(finding.ready, false);
  assert.match(finding.flags.join(' / '), reason);
  assert.throws(
    () => ledgerCSV([finding], '普通預金', '売上高', true),
    /出力可能な候補がありません/
  );
}

test('conflicting payment status aliases cannot make an unpaid reservation a journal candidate', () => {
  assertReviewOnly(rows('決済済', '未決済'), /複数の支払ステータス列の値が一致しません/);
  // Selecting the other recognized payment column cannot bypass the discrepancy.
  const findings = analyze(rows('決済済', '未決済'), {...mapping, status: '決済状況'});
  assert.equal(findings[0].ready, false);
  assert.match(findings[0].flags.join(' / '), /複数の支払ステータス列/);
});

test('blank secondary payment status also requires review instead of silently accepting paid', () => {
  assertReviewOnly(rows('決済済', ''), /複数の支払ステータス列の値が一致しません/);
});

test('conflicting booking status aliases cannot hide cancellation', () => {
  assertReviewOnly(rows('決済済', '決済済', '確定', 'キャンセル'), /複数の予約ステータス列の値が一致しません/);
  const findings = analyze(rows('決済済', '決済済', '確定', 'キャンセル'), {...mapping, bookingStatus: '予約状況'});
  assert.equal(findings[0].ready, false);
});

test('matching recognized status columns retain a valid structural candidate', () => {
  const findings = analyze(rows('決済済', '決済済', '確定', '確定'), mapping);
  assert.equal(findings[0].ready, true);
  assert.equal(findings[0].flags.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,stringifyCSV,objectRows,normalizeDate,parseYen,analyze,ledgerCSV,reportCSV,MF_HEADERS,priorIdSet,suggestColumns} from '../src/core.mjs';
const map = {id:'予約ID',date:'決済日',amount:'決済金額',status:'決済状況',description:'メニュー'};
const sample = `予約ID,決済日,決済金額,決済状況,メニュー
A1,2026/10/01,"1,200",決済済,カット
A2,2026/10/02,1000,キャンセル,カラー
A1,2026/10/03,800,決済済,再予約
A3,2026/02/30,200,決済済,悪い日付
A4,2026/10/04,500,未決済,保留`;
test('CSV quoting, CRLF, embedded newlines, escaped quotes',()=>{
 const rows = parseCSV('a,b\r\n"a,b","line1\nline2"\r\n"""ok""",z\r\n');
 assert.deepEqual(rows,[['a','b'],['a,b','line1\nline2'],['"ok"','z']]);
 assert.deepEqual(parseCSV(stringifyCSV(rows)),rows);
});
test('source row references use physical line numbers with quoted CRLF and blank records',()=>{
 const csv = '予約ID,決済日,決済金額,決済状況,メニュー\r\n' +
   'A1,2026/10/01,1200,決済済,"1行目\r\n2行目"\r\n' +
   '\r\n' +
   'A2,2026/10/02,0,未決済,確認\r\n' +
   'A3,2026/10/03,1300,決済済,通常';
 const parsed=objectRows(csv);
 assert.deepEqual(parsed.rows.map(row=>row.__line),[2,5,6]);
 const findings=analyze(parsed.rows,map);
 assert.deepEqual(findings.map(row=>row.line),[2,5,6]);
 const report=parseCSV(reportCSV(findings));
 assert.deepEqual(report.slice(1).map(row=>row[0]),['2','5','6']);
});

test('source line tracking supports LF and lone CR inside quoted cells',()=>{
 const csv='予約ID,決済日,決済金額,決済状況,メニュー\n' +
   'B1,2026/10/01,1200,決済済,"上\n下"\n' +
   'B2,2026/10/02,1200,決済済,"上\r下"\r' +
   'B3,2026/10/03,1200,決済済,通常';
 const parsed=objectRows(csv);
 assert.deepEqual(parsed.rows.map(row=>row.__line),[2,4,6]);
 assert.deepEqual(parseCSV(csv).map(row=>row[0]),['予約ID','B1','B2','B3']);
});

test('reject malformed quotes and bad row width',()=>{
 assert.throws(()=>parseCSV('a,b\n"oops,b'),/引用符/);
 assert.throws(()=>parseCSV('a,b\nc'),/列数/);
 assert.throws(()=>parseCSV('a,b\n"x"junk,y'),/引用符/);
 assert.throws(()=>parseCSV('a,b\nx"junk,y'),/引用符/);
});
test('dates and positive integer JPY amounts',()=>{
 assert.equal(normalizeDate('2026-02-30'),null);
 assert.equal(normalizeDate('2024年2月29日'),'2024/02/29');
 assert.equal(parseYen('￥12,345'),12345);
 assert.equal(parseYen('1.2'),null);
 assert.equal(parseYen('-100'),null);
});
test('duplicate, cancellation, invalid date and unpaid detection',()=>{
 const a=analyze(objectRows(sample).rows,map);
 assert.equal(a.filter(x=>x.ready).length,0);
 assert.match(a[1].flags.join(','),/キャンセル/);
 assert.match(a[2].flags.join(','),/重複/);
 assert.match(a[3].flags.join(','),/日付/);
 assert.match(a[4].flags.join(','),/未決済/);
});
test('prior CSV flags duplicate transaction IDs',()=>{
 const ids=priorIdSet('予約ID,備考\nA1,foo\n','予約ID');
 assert.match(analyze(objectRows(sample).rows,map,ids)[0].flags.join(','),/過去出力/);
});
test('ledger format and confirmation',()=>{
 const a=analyze(objectRows(sample.replace('A1,2026/10/03,800,決済済,再予約','A5,2026/10/03,800,未決済,再予約')).rows,map);
 assert.throws(()=>ledgerCSV(a,'普通預金','売上高',false),/確認/);
 const result=parseCSV(ledgerCSV(a,'普通預金','売上高',true));
 assert.deepEqual(result[0],MF_HEADERS);
 assert.equal(result.length,2);
 assert.equal(result[1][1],'2026/10/01');
 assert.equal(result[1][8],'1200');
 assert.equal(result[1][16],'1200');
 assert.equal(result[1][10],'売上高');
});
test('prevent spreadsheet injection in text fields',()=>{
 const a=analyze([{予約ID:'=1+1',決済日:'2026/10/01',決済金額:'100',決済状況:'paid',メニュー:'@malicious'}],map);
 const ledger=parseCSV(ledgerCSV(a,'普通預金','売上高',true));
 assert.match(ledger[1][18],/予約 =1\+1/);
 assert.throws(()=>ledgerCSV(a,'=NOW()','売上高',true),/形式/);
 const report=parseCSV(reportCSV(a));
 assert.match(report[1][1],/^'/);
});

// Official Money Forward journal-import field list (A-AA), updated 2026-07-09.
// https://biz.moneyforward.com/support/account/guide/import-books/ib01.html
test('Money Forward official A-AA journal schema and empty optional tail',()=>{
 const official = [
  '取引No','取引日','借方勘定科目','借方補助科目','借方部門','借方取引先',
  '借方税区分','借方インボイス','借方金額(円)','借方税額',
  '貸方勘定科目','貸方補助科目','貸方部門','貸方取引先',
  '貸方税区分','貸方インボイス','貸方金額(円)','貸方税額',
  '摘要','仕訳メモ','タグ','MF仕訳タイプ',
  '決算整理仕訳','作成日時','作成者','最終更新日時','最終更新者'
 ];
 assert.equal(official.length,27);
 assert.deepEqual(MF_HEADERS,official);
 const csv = `予約ID,決済日,決済金額,決済状況,メニュー\nTX-001,2026/10/26,1200,決済済,カット`;
 const data=analyze(objectRows(csv).rows,map);
 const [header,row]=parseCSV(ledgerCSV(data,'普通預金','売上高',true));
 assert.equal(header.length,27);
 assert.equal(row.length,27);
 assert.equal(row[1],'2026/10/26');
 assert.equal(row[8],'1200');
 assert.equal(row[16],'1200');
 assert.equal(row[18],'予約 TX-001 カット');
 assert.deepEqual(row.slice(22),['','','','','']);
});

test('STORES reservation and payment status are mapped independently',()=>{
 const suggestion = suggestColumns(['予約ID','予約日時','支払ステータス','ステータス','金額']);
 assert.equal(suggestion.status,'支払ステータス');
 assert.equal(suggestion.bookingStatus,'ステータス');
 assert.equal(suggestion.date,''); // booking date is not a confirmed payment/transaction date
 assert.equal(suggestColumns(['ステータス']).status,'');
});

test('paid but cancelled bookings must never become journal candidates',()=>{
 const csv = [
  '予約ID,決済日,決済金額,支払ステータス,ステータス,メニュー',
  'B1,2026/10/01,1000,決済済,キャンセル済,返金対象',
  'B2,2026/10/02,2000,支払済,予約確定,通常',
  'B3,2026/10/03,3000,決済済,,不明な予約状態',
  'B4,2026/10/04,4000,返金済,予約確定,返金',
  'B5,2026/10/05,5000,paid,取消,取消済'
 ].join('\n');
 const mapping={id:'予約ID',date:'決済日',amount:'決済金額',status:'支払ステータス',bookingStatus:'ステータス',description:'メニュー'};
 const findings = analyze(objectRows(csv).rows,mapping);
 assert.deepEqual(findings.map(x=>x.ready),[false,true,false,false,false]);
 assert.match(findings[0].flags.join(','),/予約キャンセル/);
 assert.match(findings[2].flags.join(','),/予約ステータスが空欄/);
 assert.match(findings[3].flags.join(','),/返金/);
 assert.match(findings[4].flags.join(','),/予約キャンセル/);
 const ledger=parseCSV(ledgerCSV(findings,'普通預金','売上高',true));
 assert.equal(ledger.length,2);
 assert.match(ledger[1][18],/B2/);
 const report=parseCSV(reportCSV(findings));
 assert.equal(report[0][5],'予約状況');
 assert.equal(report[1][5],'キャンセル済');
 const withoutBooking = analyze(objectRows(csv).rows,{...mapping,bookingStatus:''});
 assert.equal(withoutBooking.filter(x=>x.ready).length,0);
 assert.match(withoutBooking[1].flags.join(','),/未指定/);
 assert.throws(()=>analyze(objectRows(csv).rows,{...mapping,bookingStatus:'支払ステータス'}),/別の列/);
 assert.throws(()=>analyze(objectRows(csv).rows,{...mapping,bookingStatus:'決済金額'}),/別の列/);
});

test('core rejects reusing a CSV column for different mandatory financial fields',()=>{
  // The browser checks this already, but future integrations can call analyze() directly.
  // Every pair of mandatory fields must be mapped to distinct source columns.
  const rows=objectRows([
    '予約ID,決済日,決済金額,決済状況',
    'A1,2026/10/01,1200,決済済'
  ].join('\n')).rows;
  const keys=['id','date','amount','status'];
  const valid={id:'予約ID',date:'決済日',amount:'決済金額',status:'決済状況'};
  for(let i=0;i<keys.length;i++){
    for(let j=i+1;j<keys.length;j++){
      const invalid={...valid,[keys[j]]:valid[keys[i]]};
      assert.throws(()=>analyze(rows,invalid),/異なる4つの必須列/,keys[i]+' / '+keys[j]);
    }
  }
  assert.equal(analyze(rows,valid)[0].ready,true);
});

test('STORES purchase history timestamp must not become an accounting date',()=>{
  // STORES official purchase-history FAQ (updated 2025-12-04) lists 購入日時,
  // but does not establish the accounting recognition date or settlement date.
  const listed=['購入日時','商品名','金額','支払い方法','スタッフ','ステータス','オーダー番号','顧客名'];
  assert.equal(suggestColumns(listed).date,'');
  assert.equal(suggestColumns(listed).status,''); // generic ステータス is not payment status
  const csv=[
    'オーダー番号,購入日時,金額,支払ステータス,予約ステータス',
    'P-001,2026/10/01 12:30,1200,決済済,確定'
  ].join('\\n');
  const mapping={id:'オーダー番号',date:'購入日時',amount:'金額',status:'支払ステータス',bookingStatus:'予約ステータス'};
  const findings=analyze(objectRows(csv).rows,mapping);
  assert.equal(findings[0].ready,false);
  assert.match(findings[0].flags.join(' / '),/購入日時を会計取引日とする根拠が未確認/);
  assert.throws(()=>ledgerCSV(findings,'普通預金','売上高',true),/出力可能な候補がありません/);
  // Explicitly supplied transaction-date column remains usable (still not an accounting guarantee).
  const withPaymentDate=objectRows(csv.replaceAll('購入日時','決済日')).rows;
  assert.equal(analyze(withPaymentDate,{...mapping,date:'決済日'})[0].ready,true);
});

test('strict yen parsing preserves only well-formed integer amounts',()=>{
  for (const [input, expected] of [
    ['1200',1200],['1,200',1200],['￥12,345',12345],['¥ 1,234,567',1234567],
    ['1,,200',null],['12,34',null],['1,23,456',null],['1 200',null],
    ['1,200円',null],['+1200',null],['1.200',null],['0',null],
    ['9007199254740992',null],['=1+1',null]
  ]) assert.equal(parseYen(input),expected,input);
});

test('strict date parsing rejects junk suffixes and invalid times',()=>{
  for (const [input, expected] of [
    ['2026/10/01','2026/10/01'],
    ['2026-10-01 09:30','2026/10/01'],
    ['2026年10月1日 23:59:59','2026/10/01'],
    ['2026/10/01T12:05','2026/10/01'],
    ['2026/10/01 cancelled',null],
    ['2026/10/01 24:00',null],
    ['2026/10/01 12:60',null],
    ['2026/10/01 12:30:60',null],
    ['2026/10/01 12:30 extra',null]
  ]) assert.equal(normalizeDate(input),expected,input);
});

test('invalid source amount and date are review-only, not journal candidates',()=>{
  const csv = [
    '予約ID,決済日,決済金額,決済状況,メニュー',
    'S1,2026/10/01,"1,,200",決済済,金額不正',
    'S2,2026/10/02 garbage,1200,決済済,日付不正',
    'S3,2026/10/03,"1,200",決済済,正常'
  ].join('\n');
  const result = analyze(objectRows(csv).rows,map);
  assert.deepEqual(result.map(r=>r.ready),[false,false,true]);
  assert.match(result[0].flags.join(','),/金額/);
  assert.match(result[1].flags.join(','),/日付/);
  const journal=parseCSV(ledgerCSV(result,'普通預金','売上高',true));
  assert.equal(journal.length,2);
  assert.match(journal[1][18],/S3/);
});


test('STORES confirmed and approval-pending reservations are not treated alike', () => {
  // STORES official FAQ lists 確定, キャンセル, 承認待ち as distinct statuses.
  // These rows are synthetic; the actual CSV field values remain unverified.
  const csv = [
    '予約ID,決済日,決済金額,支払ステータス,ステータス',
    'P1,2026/10/01,1200,決済済,承認待ち',
    'P2,2026/10/02,1200,決済済,確定',
    'P3,2026/10/03,1200,決済済,キャンセル',
    'P4,2026/10/04,1200,決済済,仮予約',
    'P5,2026/10/05,1200,決済済,予約確定',
    'P6,2026/10/06,1200,決済済,未確認の新状態'
  ].join('\n');
  const mapping = {id:'予約ID',date:'決済日',amount:'決済金額',status:'支払ステータス',bookingStatus:'ステータス'};
  const findings = analyze(objectRows(csv).rows, mapping);
  assert.deepEqual(findings.map(x => x.ready), [false, true, false, false, true, false]);
  for (const i of [0, 3, 5]) assert.match(findings[i].flags.join(' / '), /未確定|未確認/);
  assert.match(findings[2].flags.join(' / '), /予約キャンセル/);
  const journal = parseCSV(ledgerCSV(findings, '普通預金', '売上高', true));
  assert.equal(journal.length, 3); // header + confirmed candidates only
  assert.match(journal[1][18], /P2/);
  assert.match(journal[2][18], /P5/);
});

test('unknown booking status is review-only even when payment is explicitly paid', () => {
  const mapping = {id:'予約ID',date:'決済日',amount:'決済金額',status:'支払ステータス',bookingStatus:'ステータス'};
  const rows = [
    {予約ID:'X1',決済日:'2026/10/01',決済金額:'2000',支払ステータス:'paid',ステータス:'保留'},
    {予約ID:'X2',決済日:'2026/10/01',決済金額:'2000',支払ステータス:'paid',ステータス:'confirmed'}
  ];
  const findings = analyze(rows, mapping);
  assert.equal(findings[0].ready, false);
  assert.equal(findings[1].ready, true);
  assert.match(reportCSV(findings), /予約未確定または未確認のステータス/);
});

test('reservation and application timestamps cannot silently become journal dates', () => {
  // The STORES reservation-list FAQ names these timestamps, but does not establish
  // that any of them is a settlement date or a valid accounting recognition date.
  const csv = [
    '予約ID,申込日時,予約日時,希望の予約日時,来客日時,来客／キャンセル日時,決済日,決済金額,支払ステータス,ステータス',
    'D1,2026/10/01 09:00,2026/10/02 10:00,2026/10/02 10:00,2026/10/03 11:00,2026/10/03 11:00,2026/10/04,1200,決済済,確定'
  ].join('\n');
  const rows = objectRows(csv).rows;
  const base = {id:'予約ID',amount:'決済金額',status:'支払ステータス',bookingStatus:'ステータス'};
  for (const date of ['申込日時','予約日時','希望の予約日時','来客日時','来客／キャンセル日時']) {
    const findings = analyze(rows, {...base,date});
    assert.equal(findings[0].ready, false, date);
    assert.match(findings[0].flags.join(' / '), /会計取引日とする根拠が未確認/, date);
    assert.match(reportCSV(findings), /要確認/, date);
    assert.throws(() => ledgerCSV(findings,'普通預金','売上高',true), /出力可能な候補がありません/, date);
  }
});

test('explicit payment-date column still permits a structurally valid candidate', () => {
  const rows = objectRows([
    '予約ID,申込日時,決済日,決済金額,支払ステータス,ステータス',
    'D2,2026/10/01,2026/10/04,1200,決済済,確定'
  ].join('\n')).rows;
  const mapping = {id:'予約ID',date:'決済日',amount:'決済金額',status:'支払ステータス',bookingStatus:'ステータス'};
  const findings = analyze(rows, mapping);
  assert.equal(findings[0].ready, true);
  const journal = parseCSV(ledgerCSV(findings,'普通預金','売上高',true));
  assert.equal(journal[1][1], '2026/10/04');
  // This does not validate accounting policy or actual STORES CSV field names.
});

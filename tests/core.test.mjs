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
 assert.throws(()=>analyze(objectRows(csv).rows,{...mapping,bookingStatus:'支払ステータス'}),/別の列/);
});

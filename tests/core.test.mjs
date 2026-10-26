import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,stringifyCSV,objectRows,normalizeDate,parseYen,analyze,ledgerCSV,reportCSV,MF_HEADERS,priorIdSet} from '../src/core.mjs';
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

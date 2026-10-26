import test from 'node:test';
import assert from 'node:assert/strict';
import {readCSVFile, MAX_CSV_BYTES} from '../src/csv-file.mjs';
import {parseCSV, objectRows, MAX_INPUT_ROWS, MAX_INPUT_COLUMNS} from '../src/core.mjs';

function fakeFile(bytes, reportedSize = bytes.byteLength) {
  return {size:reportedSize, async arrayBuffer() {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }};
}

test('oversized CSV is rejected before arrayBuffer is called', async () => {
  let reads = 0;
  const file = {size:MAX_CSV_BYTES + 1, async arrayBuffer(){reads++; throw new Error('must not read');}};
  await assert.rejects(readCSVFile(file), /12MB/);
  assert.equal(reads, 0);
});

test('size is checked again after reading, even if File.size is incorrect', async () => {
  const file = fakeFile(new Uint8Array(MAX_CSV_BYTES + 1), 1);
  await assert.rejects(readCSVFile(file), /12MB/);
});

test('valid UTF-8 and Shift_JIS are decoded; undecodable bytes fail', async () => {
  const utf8 = new TextEncoder().encode('予約ID,金額\nA1,1200\n');
  assert.equal(await readCSVFile(fakeFile(utf8)), '予約ID,金額\nA1,1200\n');
  const shiftJis = Uint8Array.from([0x82, 0xa0, 0x2c, 0x31]); // あ,1
  assert.equal(await readCSVFile(fakeFile(shiftJis)), 'あ,1');
  await assert.rejects(readCSVFile(fakeFile(Uint8Array.from([0x81]))));
  await assert.rejects(readCSVFile({size:-1,arrayBuffer:async()=>new ArrayBuffer(0)}), /サイズ/);
});

test('CSV row and column caps stop untrusted input while parsing', () => {
  assert.deepEqual(parseCSV('a,b\n"x\ny",2\n', {maxRows:2,maxColumns:2}), [['a','b'],['x\ny','2']]);
  assert.throws(() => parseCSV('a,b,c\n1,2,3', {maxColumns:2}), /列数上限/);
  assert.throws(() => parseCSV('a\n1\n2\n', {maxRows:2}), /行数上限/);
  assert.equal(MAX_INPUT_COLUMNS, 200);
  assert.equal(MAX_INPUT_ROWS, 50000);
  assert.throws(() => objectRows(Array.from({length:201}, (_,i)=>'h'+i).join(',')), /列数上限/);
  assert.throws(() => objectRows('id\n'+'x\n'.repeat(MAX_INPUT_ROWS+1)), /行数上限/);
});

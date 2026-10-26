import test from 'node:test';
import assert from 'node:assert/strict';
import {createUploadController} from '../src/upload-controller.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
}
function harness(readFile) {
  const state = {current:null, errors:[], resets:0};
  const uploader = createUploadController({
    readFile,
    applyCSV(text, label) {
      if (!text.startsWith('予約ID,')) throw new Error('不正CSV');
      state.current = {text, label};
    },
    reset() { state.current = null; state.resets++; },
    onError(error) { state.errors.push(error.message); }
  });
  return {state, uploader};
}

test('failed replacement upload clears prior analysis instead of keeping old data', async()=>{
  const {state, uploader} = harness(async file=>{
    if (file.name === 'bad.csv') throw new Error('CSVを読み込めません');
    return '予約ID,金額\nA1,100';
  });
  await uploader.loadFile({name:'good.csv'});
  assert.equal(state.current.label,'good.csv');
  await uploader.loadFile({name:'bad.csv'});
  assert.equal(state.current,null);
  assert.deepEqual(state.errors,['CSVを読み込めません']);
  assert.equal(state.resets,2);
});

test('out-of-order reads cannot replace a newer uploaded CSV', async()=>{
  const a=deferred(), b=deferred();
  const {state, uploader} = harness(file=>file.name === 'a.csv' ? a.promise : b.promise);
  const loadingA = uploader.loadFile({name:'a.csv'});
  const loadingB = uploader.loadFile({name:'b.csv'});
  b.resolve('予約ID,金額\nB1,200');
  await loadingB;
  assert.equal(state.current.label,'b.csv');
  a.resolve('予約ID,金額\nA1,100');
  await loadingA;
  assert.equal(state.current.label,'b.csv');
  assert.equal(state.errors.length,0);
});

test('demo selection cancels pending upload and ignores stale read errors', async()=>{
  const pending=deferred();
  const {state, uploader} = harness(()=>pending.promise);
  const loading=uploader.loadFile({name:'old.csv'});
  uploader.loadText('予約ID,金額\nD1,300','demo');
  pending.reject(new Error('old upload failed'));
  await loading;
  assert.equal(state.current.label,'demo');
  assert.deepEqual(state.errors,[]);
});

test('parse failure and empty selection leave no previous CSV available', async()=>{
  let text='予約ID,金額\nA1,100';
  const {state, uploader} = harness(async()=>text);
  await uploader.loadFile({name:'first.csv'});
  text='not a CSV';
  await uploader.loadFile({name:'invalid.csv'});
  assert.equal(state.current,null);
  assert.deepEqual(state.errors,['不正CSV']);
  text='予約ID,金額\nA2,200';
  await uploader.loadFile({name:'invalid.csv'}); // retry same file
  assert.equal(state.current.label,'invalid.csv');
  await uploader.loadFile(null);
  assert.equal(state.current,null);
});

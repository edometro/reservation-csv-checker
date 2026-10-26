import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisController} from '../src/analysis-controller.mjs';
import {objectRows,analyze,priorIdSet} from '../src/core.mjs';

function deferred(){
  let resolve, reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}
function harness(){
  const state={results:[],errors:[]};
  const controller=createAnalysisController({
    onResult: result=>state.results.push(result),
    onError: error=>state.errors.push(error.message)
  });
  return {controller,state};
}
const csv='予約ID,決済日,決済金額,決済状況\nA1,2026/10/01,1200,決済済';
const mapping={id:'予約ID',date:'決済日',amount:'決済金額',status:'決済状況'};

test('changing CSV while previous-file read is pending cannot publish stale analysis',async()=>{
  const pending=deferred();
  const {controller,state}=harness();
  const running=controller.run(async()=>{
    const prior=priorIdSet(await pending.promise,'予約ID');
    return analyze(objectRows(csv).rows,mapping,prior);
  });
  controller.invalidate(); // New main CSV selected: old results must stay hidden.
  pending.resolve('予約ID\nA1');
  await running;
  assert.deepEqual(state.results,[]);
  assert.deepEqual(state.errors,[]);
});

test('changing mapping or prior-file selection invalidates an in-flight result',async()=>{
  for(const change of ['mapping','prior selection','prior header']){
    const pending=deferred();
    const {controller,state}=harness();
    const running=controller.run(()=>pending.promise);
    controller.invalidate(); // Input event calls invalidateResults().
    pending.resolve({change,ready:true});
    await running;
    assert.deepEqual(state.results,[],change);
  }
});

test('latest analysis wins when two prior CSV reads finish out of order',async()=>{
  const a=deferred(),b=deferred();
  const {controller,state}=harness();
  const first=controller.run(()=>a.promise);
  const second=controller.run(()=>b.promise);
  b.resolve({id:'new'});
  await second;
  a.resolve({id:'old'});
  await first;
  assert.deepEqual(state.results,[{id:'new'}]);
  assert.deepEqual(state.errors,[]);
});

test('stale prior CSV errors are ignored but current errors are surfaced',async()=>{
  const old=deferred();
  const {controller,state}=harness();
  const first=controller.run(()=>old.promise);
  const second=controller.run(async()=>{throw new Error('最新のCSV形式が不正');});
  old.reject(new Error('過去のCSV読み込み失敗'));
  await Promise.all([first,second]);
  assert.deepEqual(state.results,[]);
  assert.deepEqual(state.errors,['最新のCSV形式が不正']);
});

test('successful latest analysis still produces candidates normally',async()=>{
  const {controller,state}=harness();
  await controller.run(async()=>analyze(objectRows(csv).rows,mapping));
  assert.equal(state.results.length,1);
  assert.equal(state.results[0][0].ready,true);
  assert.deepEqual(state.errors,[]);
});

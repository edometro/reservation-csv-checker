import {objectRows,analyze,ledgerCSV,reportCSV,priorIdSet,suggestColumns,summarizeAnalysis} from './core.mjs';
import {createUploadController} from './upload-controller.mjs';
import {createAnalysisController} from './analysis-controller.mjs';
import {readCSVFile} from './csv-file.mjs';
import {auditJournalCSV} from './journal-audit.mjs';
const $ = id => document.getElementById(id);
let current = null, findings = null;
const sample = '予約ID,決済日,決済金額,決済状況,メニュー\nD001,2026/10/01,1200,決済済,カット\nD002,2026/10/02,3000,未決済,カラー\nD003,2026/10/03,2000,キャンセル,ネイル\nD004,2026/10/04,850,paid,体験\nD004,2026/10/04,850,paid,体験';
const MAPPING = ['id','date','amount','status','bookingStatus','description'];
const analysisController = createAnalysisController({
  onResult: renderFindings,
  onError: error => alertMessage(error.message ?? String(error))
});
function invalidateResults(){
  analysisController.invalidate();
  findings = null;
  $('resultsection').hidden=true;
  $('ledgersection').hidden=true;
  $('confirm').checked=false;
  $('downloadledger').disabled=true;
  $('journalaudit').hidden=true;
  $('journalaudit').textContent='';
}
function alertMessage(text){$('feedback').textContent=text;$('feedback').hidden=false;}
function clearMessage(){$('feedback').hidden=true;}
function applyCSV(text,label){
 const parsed=objectRows(text);
 if(parsed.rows.length>50000) throw new Error('試作版では50,000件以下にしてください');
 current=parsed;invalidateResults();
 const suggestions = suggestColumns(current.headers);
 for(const field of MAPPING){
   const node=$(`map-${field}`);node.replaceChildren();
   node.add(new Option('選択してください',''));
   for(const header of current.headers)node.add(new Option(header,header));
   node.value=suggestions[field];
 }
 $('mappingsection').hidden=false;
 $('fileinfo').textContent=`${label} / ${current.rows.length}レコード / ${current.headers.length}列`;
 clearMessage();
}
const uploader = createUploadController({
  readFile: readCSVFile,
  applyCSV,
  reset() {
    current = null;
    invalidateResults();
    $('mappingsection').hidden = true;
    $('fileinfo').textContent = '';
    $('prior').value = '';
    $('priorheader').value = '';
    clearMessage();
  },
  onError: error => alertMessage(error.message ?? String(error))
});
$('file').addEventListener('change',e=>{
  const file = e.target.files[0] ?? null;
  e.target.value = ''; // Allow selecting the same file again after a failed load.
  void uploader.loadFile(file);
});
$('demo').addEventListener('click',()=>uploader.loadText(sample,'合成サンプル（実顧客データではありません）'));
function renderFindings(result){
   findings=result;
   $('total').textContent=findings.length;
   const summary=summarizeAnalysis(findings);
   $('ok').textContent=summary.candidateCount;
   $('review').textContent=summary.reviewCount;
   $('candidate-yen').textContent=summary.candidateYen.toLocaleString('ja-JP')+' 円';
   $('review-yen').textContent=summary.reviewYen.toLocaleString('ja-JP')+' 円';
   $('unknown-amounts').textContent=String(summary.unknownAmountCount)+' 件';
   const tbody=$('preview');tbody.replaceChildren();
   for(const item of findings.slice(0,200)){
     const tr=document.createElement('tr');
     const values=[item.line,item.id,item.date??'—',item.amount?.toLocaleString('ja-JP')??'—',item.status,item.bookingStatus||'—'];
     for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}
     const td=document.createElement('td'),span=document.createElement('span');span.className=`pill ${item.ready?'ok':'review'}`;span.textContent=item.ready?'候補':'要確認';span.title=item.flags.join(' / ');td.append(span);tr.append(td);tbody.append(tr);
   }
   $('resultsection').hidden=false;$('ledgersection').hidden=false;
   $('confirm').checked=false;$('downloadledger').disabled=true;
   refreshJournalAudit();
   clearMessage();$('resultsection').scrollIntoView({behavior:'smooth',block:'start'});
}
$('analyze').addEventListener('click',()=>{
  invalidateResults();
  void analysisController.run(async()=>{
    if(!current)throw new Error('CSVを選択してください');
    const rows=current.rows; // Snapshot the current CSV before awaiting prior-file reads.
    const mapping={};for(const field of MAPPING)mapping[field]=$('map-'+field).value;
    if(!['id','date','amount','status'].every(field=>mapping[field])) throw new Error('必須列をすべて指定してください');
    if(new Set([mapping.id,mapping.date,mapping.amount,mapping.status]).size!==4)throw new Error('異なる4つの必須列を指定してください');
    let priorKeys=new Set();
    const prior=$('prior').files[0];
    if(prior){
      const h=$('priorheader').value.trim() || mapping.id;
      priorKeys=priorIdSet(await readCSVFile(prior),h);
    }
    return analyze(rows,mapping,priorKeys);
  });
});
function refreshJournalAudit(){
  const panel=$('journalaudit');
  if(!findings){panel.hidden=true;$('downloadledger').disabled=true;return;}
  panel.hidden=false;
  let valid=false;
  try{
    // Inspect the exact generated CSV, not an independent approximation of it.
    const draft=ledgerCSV(findings,$('debit').value,$('credit').value,true);
    const audit=auditJournalCSV(draft);
    valid=audit.errors.length===0;
    panel.textContent=[
      `仕訳候補 ${audit.rowCount}件：${valid?'列・日付・貸借金額の形式検査は通過':'形式検査で問題を検出'}`,
      ...audit.errors.map(message=>'【要修正】'+message),
      ...audit.warnings.map(message=>'【注意】'+message),
      '【要手動確認】仕訳日・科目の実在・税区分・収益認識・返金/手数料・過去インポートは自動検証できません。'
    ].join('\n');
  }catch(error){
    panel.textContent='【要修正】'+error.message;
  }
  $('downloadledger').disabled=!valid || !$('confirm').checked;
}
function download(text,filename){const blob=new Blob(['\uFEFF',text],{type:'text/csv;charset=utf-8'});const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
for(const field of MAPPING){
  $('map-'+field).addEventListener('change',invalidateResults);
}
$('prior').addEventListener('change',invalidateResults);
$('priorheader').addEventListener('input',invalidateResults);
$('downloadreport').addEventListener('click',()=>{if(findings)download(reportCSV(findings),'validation-report.csv');});
for(const field of ['debit','credit']){
  $(field).addEventListener('input',()=>{
    $('confirm').checked=false;
    refreshJournalAudit();
  });
}
$('confirm').addEventListener('change',refreshJournalAudit);
$('downloadledger').addEventListener('click',()=>{try{if(!findings)throw new Error('先に検査してください');const csv=ledgerCSV(findings,$('debit').value,$('credit').value,$('confirm').checked);const audit=auditJournalCSV(csv);if(audit.errors.length)throw new Error('仕訳候補CSVの自動チェックに失敗: '+audit.errors.join(' / '));download(csv,'mf-journal-candidates.csv');clearMessage();}catch(err){alertMessage(err.message);}});

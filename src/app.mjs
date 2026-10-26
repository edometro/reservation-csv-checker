import {objectRows,analyze,ledgerCSV,reportCSV,priorIdSet,suggestColumns} from './core.mjs';
import {createUploadController} from './upload-controller.mjs';
const $ = id => document.getElementById(id);
let current = null, findings = null;
const sample = '予約ID,決済日,決済金額,決済状況,メニュー\nD001,2026/10/01,1200,決済済,カット\nD002,2026/10/02,3000,未決済,カラー\nD003,2026/10/03,2000,キャンセル,ネイル\nD004,2026/10/04,850,paid,体験\nD004,2026/10/04,850,paid,体験';
const MAPPING = ['id','date','amount','status','bookingStatus','description'];
function invalidateResults(){
  findings = null;
  $('resultsection').hidden=true;
  $('ledgersection').hidden=true;
  $('confirm').checked=false;
  $('downloadledger').disabled=true;
}
function alertMessage(text){$('feedback').textContent=text;$('feedback').hidden=false;}
function clearMessage(){$('feedback').hidden=true;}
async function readFile(file){
 const buffer = await file.arrayBuffer();
 if (buffer.byteLength > 12 * 1024 * 1024) throw new Error('試作版ではCSVを12MB以下にしてください');
 try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}
 catch{return new TextDecoder('shift_jis',{fatal:true}).decode(buffer);}
}
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
  readFile,
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
$('analyze').addEventListener('click',async()=>{
 try{
   if(!current)throw new Error('CSVを選択してください');
   invalidateResults();
   const mapping={};for(const field of MAPPING)mapping[field]=$(`map-${field}`).value;
   if(!['id','date','amount','status'].every(field=>mapping[field])) throw new Error('必須列をすべて指定してください');
   if(new Set([mapping.id,mapping.date,mapping.amount,mapping.status]).size!==4)throw new Error('異なる4つの必須列を指定してください');
   let priorKeys=new Set(); const prior=$('prior').files[0];
   if(prior){const h=$('priorheader').value.trim() || mapping.id;priorKeys=priorIdSet(await readFile(prior),h);}
   findings=analyze(current.rows,mapping,priorKeys);
   $('total').textContent=findings.length;
   const ok=findings.filter(r=>r.ready).length;
   $('ok').textContent=ok;$('review').textContent=findings.length-ok;
   const tbody=$('preview');tbody.replaceChildren();
   for(const item of findings.slice(0,200)){
     const tr=document.createElement('tr');
     const values=[item.line,item.id,item.date??'—',item.amount?.toLocaleString('ja-JP')??'—',item.status,item.bookingStatus||'—'];
     for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}
     const td=document.createElement('td'),span=document.createElement('span');span.className=`pill ${item.ready?'ok':'review'}`;span.textContent=item.ready?'候補':'要確認';span.title=item.flags.join(' / ');td.append(span);tr.append(td);tbody.append(tr);
   }
   $('resultsection').hidden=false;$('ledgersection').hidden=false;
   $('confirm').checked=false;$('downloadledger').disabled=true;
   clearMessage();$('resultsection').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(err){alertMessage(err.message);}
});
function download(text,filename){const blob=new Blob(['\uFEFF',text],{type:'text/csv;charset=utf-8'});const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
for(const field of MAPPING){
  $('map-'+field).addEventListener('change',invalidateResults);
}
$('prior').addEventListener('change',invalidateResults);
$('priorheader').addEventListener('input',invalidateResults);
$('downloadreport').addEventListener('click',()=>{if(findings)download(reportCSV(findings),'validation-report.csv');});
$('confirm').addEventListener('change',e=>{$('downloadledger').disabled=!e.target.checked || !findings;});
$('downloadledger').addEventListener('click',()=>{try{if(!findings)throw new Error('先に検査してください');download(ledgerCSV(findings,$('debit').value,$('credit').value,$('confirm').checked),'mf-journal-candidates.csv');clearMessage();}catch(err){alertMessage(err.message);}});

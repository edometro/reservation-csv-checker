import {objectRows,analyze,ledgerCSV,reportCSV,priorIdSet} from './core.mjs';
const $ = id => document.getElementById(id);
let current = null, findings = null;
const sample = '予約ID,決済日,決済金額,決済状況,メニュー\nD001,2026/10/01,1200,決済済,カット\nD002,2026/10/02,3000,未決済,カラー\nD003,2026/10/03,2000,キャンセル,ネイル\nD004,2026/10/04,850,paid,体験\nD004,2026/10/04,850,paid,体験';
const MAPPING = {id:['予約ID','取引ID','オーダー番号','注文ID','予約番号'],date:['決済日','支払日','購入日時','入金日','取引日'],amount:['決済金額','金額','売上金額','支払金額','決済額'],status:['決済状況','支払状況','ステータス','支払いステータス'],description:['メニュー','商品名','摘要','予約メニュー']};
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
 current=parsed;findings=null;
 for(const [field,likely] of Object.entries(MAPPING)){
   const node=$(`map-${field}`);node.replaceChildren();
   node.add(new Option('選択してください',''));
   for(const header of current.headers)node.add(new Option(header,header));
   node.value=likely.find(x=>current.headers.includes(x))??'';
 }
 $('mappingsection').hidden=false;$('resultsection').hidden=true;$('ledgersection').hidden=true;
 $('fileinfo').textContent=`${label} / ${current.rows.length}レコード / ${current.headers.length}列`;
 clearMessage();
}
$('file').addEventListener('change',async e=>{try{if(!e.target.files.length)return;applyCSV(await readFile(e.target.files[0]),e.target.files[0].name);}catch(err){alertMessage(err.message);}});
$('demo').addEventListener('click',()=>{try{applyCSV(sample,'合成サンプル（実顧客データではありません）');}catch(err){alertMessage(err.message);}});
$('analyze').addEventListener('click',async()=>{
 try{
   if(!current)throw new Error('CSVを選択してください');
   const mapping={};for(const field of Object.keys(MAPPING))mapping[field]=$(`map-${field}`).value;
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
     const values=[item.line,item.id,item.date??'—',item.amount?.toLocaleString('ja-JP')??'—',item.status];
     for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}
     const td=document.createElement('td'),span=document.createElement('span');span.className=`pill ${item.ready?'ok':'review'}`;span.textContent=item.ready?'候補':'要確認';span.title=item.flags.join(' / ');td.append(span);tr.append(td);tbody.append(tr);
   }
   $('resultsection').hidden=false;$('ledgersection').hidden=false;
   $('confirm').checked=false;$('downloadledger').disabled=true;
   clearMessage();$('resultsection').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(err){alertMessage(err.message);}
});
function download(text,filename){const blob=new Blob(['\uFEFF',text],{type:'text/csv;charset=utf-8'});const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
$('downloadreport').addEventListener('click',()=>{if(findings)download(reportCSV(findings),'validation-report.csv');});
$('confirm').addEventListener('change',e=>{$('downloadledger').disabled=!e.target.checked;});
$('downloadledger').addEventListener('click',()=>{try{if(!findings)throw new Error('先に検査してください');download(ledgerCSV(findings,$('debit').value,$('credit').value,$('confirm').checked),'mf-journal-candidates.csv');clearMessage();}catch(err){alertMessage(err.message);}});

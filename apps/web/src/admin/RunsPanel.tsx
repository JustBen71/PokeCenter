import {useState} from 'react';
import {runStatusLabels,type Run} from '@pokerace/shared';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLive} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {runActions} from '../course/course-model';

// Every participant's current Run with the next admin actions, in one table.
export function RunsPanel(){
 const {lobby}=useLobby();const {members,runs}=useLive();const toast=useToast();
 const [busy,setBusy]=useState(false);
 const current=(accountId:string)=>{const own=runs.filter(r=>r.accountId===accountId).sort((a,b)=>b.number-a.number);return own.find(r=>r.status==='RUNNING')??own.find(r=>r.status==='NOT_STARTED')??own[0]??null;};
 const act=async(accountId:string,name:string,run:Run|null,a:ReturnType<typeof runActions>[number])=>{
  if(a.danger&&!window.confirm(`${a.label} pour ${name} ?`))return;
  setBusy(true);
  try{const r=a.kind==='create'?await api<Run>(`/api/lobbies/${lobby.id}/runs`,{method:'POST',body:{accountId,start:a.start}}):await api<Run>(`/api/lobbies/${lobby.id}/runs/${run!.id}/status`,{method:'POST',body:{status:a.status}});
   toast.success(`${name} : Run #${r.number} ${runStatusLabels[r.status].toLowerCase()}`);}
  catch(e){toast.error(e);}finally{setBusy(false);}
 };
 return <section className="panel">
  <header className="panel-head"><h2>Runs</h2><small className="muted">{runs.filter(r=>r.status==='RUNNING').length} en cours</small></header>
  <ul className="review-list">{members.map(m=>{const run=current(m.id);return <li key={m.id}>
   <div><strong>{m.name}</strong><small>{run?`Run #${run.number} · ${runStatusLabels[run.status]}`:'Aucune Run'}</small></div>
   <div className="row-actions">{runActions(run).slice(0,2).map(a=><button key={a.label} className={`btn ${a.danger?'danger':''}`} disabled={busy} onClick={()=>void act(m.id,m.name,run,a)}>{a.label}</button>)}</div>
  </li>;})}</ul>
 </section>;
}

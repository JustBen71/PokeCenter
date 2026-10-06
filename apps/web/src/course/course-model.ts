import type {LobbySummary,Objective,PublicPlayer,Run} from '@pokerace/shared';
import type {PlayerViewModel} from '../native-clients';
import {raceScore} from '../map/objective-score';

export type ClientState='playing'|'no-game'|'offline'|'never';
export const clientStateLabels:Record<ClientState,string>={playing:'En jeu',['no-game']:'Client connecté · jeu non lu',offline:'Hors ligne',never:'Client non connecté'};

export type CourseRow={
 accountId:string;name:string;sprite:string;admin:boolean;
 rank:number|null;score:number;
 run:Run|null;runs:Run[];
 view:PlayerViewModel|undefined;
 clientState:ClientState;money:number|null;location:string|null;party:PublicPlayer['state']['party'];
};

const clientState=(view:PlayerViewModel|undefined):ClientState=>{
 if(!view)return 'never';
 if(!view.display.connected)return 'offline';
 return view.source==='connection'?'no-game':'playing';
};

/**
 * One row per lobby member, even without any game data, plus any connected player not yet listed.
 * Ranking follows real progression (champion > League > badges > story); players without readable
 * progression share the bottom of the table without a rank.
 */
export function courseRows(members:LobbySummary['members'],views:PlayerViewModel[],runs:Run[],objectives:Objective[]=[]):CourseRow[]{
 const byAccount=new Map(views.map(v=>[v.accountId,v]));
 const people=[...members.map(m=>({id:m.id,name:m.name,sprite:m.sprite,admin:m.admin})),
  ...views.filter(v=>!members.some(m=>m.id===v.accountId)).map(v=>({id:v.accountId,name:v.display.state.playerName??v.accountId,sprite:v.display.account?.sprite??'brendan',admin:false}))];
 const rows=people.map(p=>{
  const view=byAccount.get(p.id);
  const own=runs.filter(r=>r.accountId===p.id).sort((a,b)=>b.number-a.number);
  const run=own.find(r=>r.status==='RUNNING')??own.find(r=>r.status==='NOT_STARTED')??own[0]??null;
  const score=view?raceScore(view.display,objectives):null;
  return {accountId:p.id,name:p.name,sprite:p.sprite,admin:p.admin,rank:null as number|null,score:score?.known?score.score:-1,run,runs:own,view,
   clientState:clientState(view),money:view?.display.state.trainer?.money??null,location:view?.display.state.location?.label??null,party:view?.display.state.party??[]};
 });
 rows.sort((a,b)=>b.score-a.score||Number(b.clientState==='playing')-Number(a.clientState==='playing')||a.name.localeCompare(b.name,'fr'));
 // Equal scores share the same rank (1, 1, 3…).
 for(const row of rows)row.rank=row.score<0?null:rows.findIndex(o=>o.score===row.score)+1;
 return rows;
}

// Admin actions offered for a player's current Run, in the order they are usually needed.
export function runActions(run:Run|null):{label:string;kind:'create'|'status';status?:Run['status'];start?:boolean;danger?:boolean}[]{
 if(!run||['LOST','COMPLETED','ABORTED'].includes(run.status))return [{label:run?'Nouvelle Run':'Démarrer la Run #1',kind:'create',start:true},{label:'Préparer sans démarrer',kind:'create',start:false}];
 if(run.status==='NOT_STARTED')return [{label:'Démarrer',kind:'status',status:'RUNNING'},{label:'Abandonner',kind:'status',status:'ABORTED',danger:true}];
 return [{label:'Marquer perdue',kind:'status',status:'LOST',danger:true},{label:'Marquer terminée',kind:'status',status:'COMPLETED'},{label:'Abandonner',kind:'status',status:'ABORTED',danger:true}];
}

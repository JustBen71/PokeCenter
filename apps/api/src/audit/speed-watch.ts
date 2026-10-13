/**
 * Server-side watch of each player's in-game play time against the server's own clock. The game counts play time in
 * frames: it runs faster than real time under fast forward and goes back after a savestate load or a rewind. Nothing
 * here depends on the client reporting its controls; it only needs the game state the client must send anyway.
 */
export type SpeedLog={action:'FAST_FORWARD'|'TIME_BACK';message:string;metadata:Record<string,number>};
export const speedRules={windowSeconds:10,fastRatio:1.5,maxEpisodeSeconds:60} as const;
const clock=(s:number)=>`${Math.floor(s/3600)} h ${String(Math.floor(s%3600/60)).padStart(2,'0')} min ${String(s%60).padStart(2,'0')} s`;

type Watch={baseGame:number;baseAt:number;ep:{real:number;game:number;max:number}|null};
export class SpeedWatch{
 private readonly watches=new Map<string,Watch>();
 /** One observation: play time in seconds, server time in ms. Returns the logs it closes. */
 sample(key:string,playTime:number,now:number):SpeedLog[]{
  const w=this.watches.get(key);
  if(!w){this.watches.set(key,{baseGame:playTime,baseAt:now,ep:null});return [];}
  const logs:SpeedLog[]=[];
  if(playTime<w.baseGame){
   this.close(w,logs);
   logs.push({action:'TIME_BACK',message:playTime<300
    ?`🆕 Temps de jeu remis à ${clock(playTime)} (nouvelle partie) — il était à ${clock(w.baseGame)}`
    :`⏪ Temps de jeu revenu de ${clock(w.baseGame)} à ${clock(playTime)} (savestate ou rembobinage)`,
    metadata:{from:w.baseGame,to:playTime}});
   w.baseGame=playTime;w.baseAt=now;return logs;
  }
  const real=(now-w.baseAt)/1000;
  if(real<speedRules.windowSeconds)return logs;
  const game=playTime-w.baseGame,ratio=game/real;
  if(ratio>=speedRules.fastRatio){
   w.ep??={real:0,game:0,max:0};w.ep.real+=real;w.ep.game+=game;w.ep.max=Math.max(w.ep.max,ratio);
   if(w.ep.real>=speedRules.maxEpisodeSeconds)this.close(w,logs);
  }else this.close(w,logs);
  w.baseGame=playTime;w.baseAt=now;
  return logs;
 }
 private close(w:Watch,logs:SpeedLog[]){
  if(!w.ep)return;
  const {real,game,max}=w.ep;w.ep=null;
  logs.push({action:'FAST_FORWARD',message:`⏩ Temps de jeu ×${(game/real).toFixed(1).replace('.',',')} (max ×${max.toFixed(1).replace('.',',')}) : +${Math.round(game)} s de jeu en ${Math.round(real)} s réelles`,
   metadata:{realSeconds:Math.round(real),gameSeconds:Math.round(game),maxSpeedPercent:Math.round(max*100)}});
 }
}

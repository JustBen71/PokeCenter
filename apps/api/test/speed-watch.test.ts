import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeedWatch} from '../src/audit/speed-watch.js';

// One observation per second of real time; `gamePerSecond` = play time added each second.
const run=(w:SpeedWatch,start:number,gamePerSecond:number[],t0=0)=>{let game=start;const logs=[];
 for(let i=0;i<gamePerSecond.length;i++){game+=gamePerSecond[i]!;logs.push(...w.sample('p',game,t0+i*1000));}return logs;};

test('speed watch: normal and paused play log nothing, fast forward is one episode, time going back is logged',()=>{
 const w=new SpeedWatch();
 assert.deepEqual(run(w,1000,[...Array(30).fill(1),...Array(20).fill(0),...Array(10).fill(1)]),[]);
 const ff=run(new SpeedWatch(),1000,[0,...Array(10).fill(1),...Array(20).fill(4),...Array(20).fill(1)]);
 assert.equal(ff.length,1);assert.equal(ff[0]!.action,'FAST_FORWARD');assert.equal(ff[0]!.metadata.maxSpeedPercent,400);
 const back=new SpeedWatch();run(back,5000,[0,1,1]);
 const logs=back.sample('p',4000,3000);
 assert.equal(logs[0]!.action,'TIME_BACK');assert.match(logs[0]!.message,/savestate/);
 assert.match(back.sample('p',12,4000)[0]!.message,/nouvelle partie/);
 // A long fast forward is reported every minute.
 assert.equal(run(new SpeedWatch(),0,[0,...Array(130).fill(3)]).length,2);
});

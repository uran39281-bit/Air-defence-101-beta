import test from 'node:test';
import assert from 'node:assert/strict';
import {createAircraft,receiveEmissions,observeMissiles,decideAircraft,flyAircraft,releaseSolution,deployCountermeasures,transition,perceivedThreats} from '../web/aviation.js';
import {RWR_TIERS} from '../web/aircraft-config.js';
const plane=(settings={})=>createAircraft('Su-27','TEST',{x:0,y:-100,z:2},{rwr:{...RWR_TIERS[2],missChance:0,ambiguousChance:0},...settings},45);
const signal={key:'emitter',x:0,y:0,z:0,beam:360,angle:0,band:'I',strength:10,waveform:'FIRE_CONTROL',family:'BETA_FIRE_CONTROL'};
function warning(a,time){receiveEmissions(a,[signal],time);receiveEmissions(a,[],time+.71);decideAircraft(a,time+.71);}
function bombing(a){a.z=2.5;a.speed=.35;a.angle=Math.PI/2;a.verticalSpeed=0;a.actualG=1;a.releaseStableFor=a.cfg.bombStableDwell;a.y=-a.speed*Math.sqrt(2*a.z/a.cfg.bombGravity);a.ai.state='ATTACK RUN';}

test('refreshes reuse a reaction timer but a new warning episode during clear cooldown waits again',()=>{
  const a=plane();warning(a,0);const old=a.ai.pending.ready,episode=perceivedThreats(a)[0].episode;
  receiveEmissions(a,[signal],1);decideAircraft(a,1);assert.equal(a.ai.pending.ready,old);assert.equal(perceivedThreats(a)[0].episode,episode);
  decideAircraft(a,old);receiveEmissions(a,[],9.1);decideAircraft(a,9.1);assert.equal(a.ai.pending,null);
  warning(a,10);assert.ok(a.ai.pending.ready>=12.71);assert.notEqual(perceivedThreats(a)[0].episode,episode);
  assert.equal(a.ai.pending.acted,false);decideAircraft(a,a.ai.pending.ready);assert.equal(a.ai.pending.acted,true);
});
test('a warning that expires before reaction does not leave a timer for the next same-priority cue',()=>{
  const a=plane({reactionMin:12,reactionMax:12});warning(a,0);const old=a.ai.pending.ready;
  receiveEmissions(a,[],8.1);decideAircraft(a,8.1);assert.equal(a.ai.pending,null);warning(a,9);assert.ok(a.ai.pending.ready>old);
});
test('different observed threats each get one timer and shortest credible TTI is primary',()=>{
  const a=plane();const t=(id,tti)=>({id,episode:id,priority:4,class:'OBSERVED MISSILE',source:'VISUAL',confidence:.8,bearing:180,timeToImpactEstimate:tti,expires:20});
  a.perception.observed.set('slow',t('slow',8));decideAircraft(a,0);const slow=a.ai.pending.ready;
  a.perception.observed.set('fast',t('fast',2));decideAircraft(a,.2);const fast=a.ai.pending.ready;assert.equal(a.ai.primary.id,'fast');assert.notEqual(fast,slow);
  decideAircraft(a,.4);assert.equal(a.ai.pending.ready,fast);a.perception.observed.delete('fast');decideAircraft(a,.5);assert.equal(a.ai.pending.ready,slow);
});
test('TTI stays unknown for sparse or receding noisy observations and is estimated after sustained approach',()=>{
  const a=plane({visualAcquire:0,visualRange:20,visualWeather:1});a.rng=()=>.5;
  const m={id:'source',alive:true,x:0,y:-94,z:2};
  observeMissiles(a,[m],0,.2);observeMissiles(a,[m],.2,.2);assert.equal(perceivedThreats(a)[0].timeToImpactEstimate,null);
  for(let i=2;i<=7;i++){m.y=-94+i*.5;observeMissiles(a,[m],i*.2,.2);}assert.equal(perceivedThreats(a)[0].timeToImpactEstimate,null);
  const b=plane({visualAcquire:0,visualRange:20,visualWeather:1});b.rng=()=>.5;
  for(let i=0;i<=7;i++){m.y=-94-i*.5;observeMissiles(b,[m],i*.2,.2);}
  assert.ok(perceivedThreats(b)[0].timeToImpactEstimate>0);assert.equal(perceivedThreats(b)[0].guidance,'UNKNOWN');
});
test('release needs stable flight dwell, safe envelope, low G and low climb rate',()=>{
  const a=plane();bombing(a);assert.equal(releaseSolution(a).valid,true);
  a.releaseStableFor=0;assert.equal(releaseSolution(a).valid,false);flyAircraft(a,0,.1);assert.equal(releaseSolution(a).valid,false);
  for(let i=1;i<7;i++)flyAircraft(a,i*.1,.1);assert.ok(releaseSolution(a).stable);
  a.actualG=4;assert.equal(releaseSolution(a).valid,false);a.actualG=1;a.verticalSpeed=.1;assert.equal(releaseSolution(a).valid,false);
  a.verticalSpeed=0;a.speed=.9;assert.equal(releaseSolution(a).envelope,false);
});
test('high confidence can finish an imminent safe release under FC, while distant runs and missiles interrupt',()=>{
  const a=plane({aggression:.9,confidence:.9,riskTolerance:.9});bombing(a);warning(a,0);decideAircraft(a,a.ai.pending.ready);assert.equal(a.ai.state,'ATTACK RUN');
  const far=plane({aggression:.9,confidence:.9,riskTolerance:.9});far.ai.state='ATTACK RUN';warning(far,0);decideAircraft(far,far.ai.pending.ready);assert.equal(far.ai.state,'DEFENSIVE');
  const missile=plane({aggression:.9,confidence:.9,riskTolerance:.9});bombing(missile);missile.perception.observed.set('danger',{id:'danger',episode:1,priority:4,class:'OBSERVED MISSILE',confidence:.9,bearing:180,timeToImpactEstimate:1});
  decideAircraft(missile,0);decideAircraft(missile,missile.ai.pending.ready);assert.equal(missile.ai.state,'MISSILE EVASION');
});
test('mission coordinates and exit altitude come from configuration; WP-0 assigned task stays intrusion',()=>{
  const a=plane({preset:'WP-0',mission:{objective:{x:20,y:30,z:0},intrusion:{x:0,y:-100,z:2},exit:{x:0,y:-110,z:3}}});
  assert.equal(a.mission.task,'INTRUSION / DIVERSION');flyAircraft(a,0,.1);assert.equal(a.retreat,true);const z=a.z;flyAircraft(a,1,.1);assert.ok(a.z>z);
  assert.deepEqual(a.mission.objective,{x:20,y:30,z:0});assert.throws(()=>plane({mission:{exit:{x:20,y:0,z:30}}}),/Unreachable/);const climbing=plane({preset:'WP-0',mission:{intrusion:{x:0,y:0,z:12}}});const h=climbing.z;flyAircraft(climbing,0,1);assert.ok(climbing.z>h);assert.throws(()=>plane({mission:{exit:{x:NaN,y:0,z:2}}}));
});
test('critical control loss aborts permanently and CM use remains limited per perceived episode',()=>{
  const a=plane({controlAuthority:.2});decideAircraft(a,0);assert.equal(a.ai.state,'DISENGAGE');a.controlAuthority=1;decideAircraft(a,30);assert.equal(a.ai.state,'DISENGAGE');
  const b=plane();b.perception.observed.set('missile',{id:'missile',episode:1,priority:4,class:'OBSERVED MISSILE',confidence:.8,bearing:180});decideAircraft(b,0);decideAircraft(b,b.ai.pending.ready);const decoys=[];
  for(let i=0;i<10;i++)deployCountermeasures(b,4+i*2,decoys);assert.equal(decoys.length,b.cfg.cmMaxBurstsPerEpisode);assert.equal(b.cm,b.profile.countermeasures-b.cfg.cmBurst*b.cfg.cmMaxBurstsPerEpisode);
});
test('an unknown direction causes a finite held broad maneuver without hidden-coordinate access',()=>{
  const a=plane();a.perception.observed.set('unknown',{id:'unknown',episode:1,priority:4,class:'OBSERVED MISSILE',confidence:.4});decideAircraft(a,0);decideAircraft(a,a.ai.pending.ready);const maneuver=a.ai.maneuver;
  assert.ok(Number.isFinite(maneuver.angle));flyAircraft(a,3,.1);assert.ok(Number.isFinite(a.x));decideAircraft(a,3.1);assert.equal(a.ai.maneuver,maneuver);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../web/engine.js';
import {AIRCRAFT,RWR_TIERS,AI_DEFAULTS} from '../web/aircraft-config.js';
import {createAircraft,canReceive,receiveEmissions,observeMissiles,decideAircraft,deployCountermeasures,flyAircraft,aircraftSpeedCap,releaseSolution,transition,perceivedThreats} from '../web/aviation.js';

const receiver={...RWR_TIERS[2],missChance:0,ambiguousChance:0};
const plane=(type='Su-27',settings={})=>createAircraft(type,'TEST',{x:0,y:-100,z:2},{rwr:receiver,...settings},25);
const emission=(waveform='SEARCH',overrides={})=>({key:'source',x:0,y:0,z:0,angle:-Math.PI/2,beam:360,band:'I',strength:10,waveform,family:{SEARCH:'BETA_SEARCH',FIRE_CONTROL:'BETA_FIRE_CONTROL',ILLUMINATION:'BETA_ILLUMINATION',ACTIVE_SEEKER:'BETA_SEEKER'}[waveform],...overrides});
const warn=(a,kind='FIRE_CONTROL',time=0)=>{receiveEmissions(a,[emission(kind)],time);receiveEmissions(a,[],time+a.rwr.delay+.001);};
const sim=(extra={})=>new Simulation({startAircraft:0,spawnInterval:1e9,scenarioSeconds:1e9,...extra});

test('only updated roster spawns, with separate role and mission and valid fixed presets',()=>{
  const s=sim();for(let i=0;i<12;i++)s.spawn(i);
  assert.deepEqual([...new Set(s.aircraft.map(a=>a.type))],Object.keys(AIRCRAFT));
  assert.ok(s.aircraft.every(a=>a.stealth===0&&a.profile.role&&a.profile.mission));
  assert.equal(s.aircraft.find(a=>a.type==='MiG-25').preset,'WP-0');
  assert.throws(()=>plane('MiG-25',{preset:'WP-1'}));assert.throws(()=>plane('Su-27',{preset:'WP-2'}));
});
test('GEN 0, out-of-band, unsupported waveform, occlusion, sensitivity, beam and elevation prevent reception',()=>{
  const a=plane();assert.ok(canReceive(a,emission(),0));
  for(const e of [emission('SEARCH',{band:'C'}),emission('SEARCH',{waveform:'UNSUPPORTED'}),emission('SEARCH',{strength:.001}),emission('SEARCH',{beam:10,angle:Math.PI/2}),emission('SEARCH',{y:-100,z:100})])assert.equal(canReceive(a,e,0),false);
  assert.equal(canReceive(a,emission(),0,()=>false),false);
  a.rwr={...RWR_TIERS[0]};warn(a);decideAircraft(a,10);assert.equal(a.ai.state,'MISSION APPROACH');assert.equal(a.ai.pending,null);
});
test('RWR can hear search beyond radar detection and waits for receiver plus one sampled reaction',()=>{
  const s=sim(),a=s.spawn(0);Object.assign(a,{x:0,y:-580,z:8,rwr:receiver});s.phase=0;
  s.measure(a);assert.equal(s.contacts.size,0);
  receiveEmissions(a,s.aviation.emissions(),0);assert.equal(a.perception.warnings.size,0);
  receiveEmissions(a,[],.71);assert.equal(a.perception.warnings.size,1);decideAircraft(a,.71);
  const ready=a.ai.pending.ready;assert.ok(ready>=2.71&&ready<=4.71);
  decideAircraft(a,ready-.01);assert.equal(a.ai.state,'MISSION APPROACH');assert.equal(a.ai.pending.ready,ready);
  decideAircraft(a,ready);assert.equal(a.ai.state,'CAUTIOUS');assert.equal(a.cm,a.profile.countermeasures);
});
test('TWS, selection, launcher choice and active midcourse launch do not create extra RF warnings',()=>{
  const s=sim();const a=s.spawn();a.rwr=receiver;
  const before=s.aviation.emissions();s.selected=a.id;s.launcher=3;
  s.contacts.set(a.id,{id:a.id,tracked:true,quality:1,trackTime:0,trackX:10,trackY:-100,altitude:8,vx:0,vy:.2,vz:0});
  s.auto=false;const m=s.fire();assert.ok(m);assert.equal(m.state,'MIDCOURSE');
  assert.deepEqual(s.aviation.emissions(),before);
});
test('fire-control warning is delayed and classified without leaking true source identity or position',()=>{
  const a=plane();warn(a);const reading=perceivedThreats(a)[0];
  assert.equal(reading.class,'FIRE CONTROL');assert.match(reading.id,/^RX-/);
  for(const key of ['x','y','z','target','range','count','key','timeToImpact'])assert.equal(reading[key],undefined);
  decideAircraft(a,.71);const ready=a.ai.pending.ready;decideAircraft(a,ready-.01);assert.equal(a.ai.state,'MISSION APPROACH');decideAircraft(a,ready);assert.equal(a.ai.state,'DEFENSIVE');
});
test('GEN 1 sees active seeker as unknown; GEN 2 recognizes seeker; GEN 1 illumination is generic fire control',()=>{
  const old=plane('MiG-25',{rwr:{...RWR_TIERS[1],missChance:0,ambiguousChance:0}}),modern=plane();
  warn(old,'ACTIVE_SEEKER');warn(modern,'ACTIVE_SEEKER');
  assert.equal(perceivedThreats(old)[0].class,'UNKNOWN EMITTER');assert.equal(perceivedThreats(modern)[0].class,'MISSILE SEEKER');
  const illum=plane('MiG-25',{rwr:{...RWR_TIERS[1],missChance:0,ambiguousChance:0}});warn(illum,'ILLUMINATION');assert.equal(perceivedThreats(illum)[0].class,'FIRE CONTROL');
});
test('IR produces no RF and visual surprise depends on FOV, dwell and memory',()=>{
  const s=sim(),a=plane();s.aircraft.push(a);
  const m={id:'secret',alive:true,guidance:'IR',state:'SEARCHING',x:0,y:-104,z:2,angle:Math.PI/2};s.missiles.push(m);s.radar=false;
  assert.equal(s.aviation.emissions().length,0);observeMissiles(a,[m],0,2);assert.equal(a.perception.observed.size,0);
  m.y=-96;observeMissiles(a,[m],1,.5);assert.equal(a.perception.observed.size,0);
  observeMissiles(a,[m],2,.8);assert.equal(a.perception.observed.size,1);
  const observed=[...a.perception.observed.values()][0];assert.equal(observed.guidance,'UNKNOWN');assert.match(observed.id,/^OBS-/);assert.equal(observed.timeToImpactEstimate,null);
  m.alive=false;observeMissiles(a,[m],10,.2);assert.equal(a.perception.observed.size,1);observeMissiles(a,[],14.1,.2);assert.equal(a.perception.observed.size,0);
});
test('battery off removes its emissions but airborne active seeker keeps emitting independently',()=>{
  const s=sim();s.radar=false;s.missiles.push({id:'M1',alive:true,guidance:'ACTIVE_RADAR',state:'SEARCHING',x:5,y:0,z:3,angle:0});
  assert.equal(s.aviation.emissions().length,1);assert.equal(s.aviation.emissions()[0].waveform,'ACTIVE_SEEKER');s.resetRadar();assert.equal(s.aviation.emissions().length,1);
});
test('warnings persist after signal stops and defense waits for memory and safe clear',()=>{
  const a=plane();warn(a);decideAircraft(a,.71);decideAircraft(a,5);assert.equal(a.ai.state,'DEFENSIVE');
  receiveEmissions(a,[],7.9);decideAircraft(a,7.9);assert.equal(a.ai.state,'DEFENSIVE');
  receiveEmissions(a,[],8.01);decideAircraft(a,8.01);decideAircraft(a,13.9);assert.equal(a.ai.state,'DEFENSIVE');
  decideAircraft(a,14.02);assert.equal(a.ai.state,'REASSESS');decideAircraft(a,16.1);assert.equal(a.ai.state,'MISSION APPROACH');
});
test('higher urgency interrupts delayed caution, and held maneuver does not flip each decision',()=>{
  const a=plane();warn(a,'SEARCH');decideAircraft(a,.71);const normal=a.ai.pending.ready;
  warn(a,'ACTIVE_SEEKER',.8);decideAircraft(a,1.51);const emergency=a.ai.pending.ready;assert.ok(emergency>=2.51&&emergency<=3.51);assert.notEqual(emergency,normal);
  decideAircraft(a,emergency);assert.equal(a.ai.state,'MISSILE EVASION');const move={...a.ai.maneuver};
  decideAircraft(a,emergency+.25);decideAircraft(a,emergency+.5);assert.deepEqual(a.ai.maneuver,move);
});
test('multiple perceived threats are retained, prioritized, and receiver capacity is bounded',()=>{
  const a=plane();const signals=Array.from({length:12},(_,i)=>emission(i===11?'ACTIVE_SEEKER':'SEARCH',{key:'emitter'+i}));
  receiveEmissions(a,signals,0);receiveEmissions(a,[],.71);assert.equal(a.perception.warnings.size,8);assert.equal(perceivedThreats(a)[0].class,'MISSILE SEEKER');
  decideAircraft(a,.71);decideAircraft(a,3);assert.equal(a.ai.state,'MISSILE EVASION');
});
test('countermeasures obey inventory, cooldown, reserve and release lifetime without destroying missiles',()=>{
  const a=plane();warn(a,'SEARCH');decideAircraft(a,.71);decideAircraft(a,5);const decoys=[];
  assert.equal(deployCountermeasures(a,5,decoys),false);
  warn(a,'ILLUMINATION',5);decideAircraft(a,5.71);decideAircraft(a,8);a.cm=12;assert.equal(deployCountermeasures(a,8,decoys),false);
  warn(a,'ACTIVE_SEEKER',8);decideAircraft(a,8.71);decideAircraft(a,11);a.cm=5;
  assert.ok(deployCountermeasures(a,11,decoys));assert.equal(a.cm,2);assert.equal(decoys[0].expires,14);assert.equal(deployCountermeasures(a,11.2,decoys),false);
  assert.ok(deployCountermeasures(a,12.5,decoys));assert.equal(a.cm,0);assert.equal(deployCountermeasures(a,14,decoys),false);
});
test('seeker decoys need reception geometry and dwell; resistance can defeat all decoys',()=>{
  const s=sim({aviation:{decoyResistance:1}}),a=s.spawn();Object.assign(a,{x:0,y:-10,z:2});
  const m={id:'M',alive:true,guidance:'ACTIVE_RADAR',state:'SEEKER LOCK',x:0,y:-20,z:2,angle:Math.PI/2,speed:.3,born:0,aim:{x:0,y:-10,z:2},velocity:{x:0,y:0,z:0},acquired:a.id,channel:false};
  s.aviation.decoys.push({id:'D',owner:a.id,x:0,y:-12,z:2,expires:3});s.time=.1;s.random=()=>0;
  assert.equal(s.aviation.evaluateDecoys(m),null);assert.equal(m.alive,true);
  s.aviation.cfg.decoyResistance=0;s.time=.4;assert.equal(s.aviation.evaluateDecoys(m).id,'D');s.missileStep(m,.1);assert.equal(m.acquired,a.id);
  s.time=.5;s.missileStep(m,.2);assert.equal(m.acquired,null);assert.equal(m.lockKind,'DECOY');assert.equal(m.alive,true);
  s.time=3.1;s.aviation.decoys=[];s.missileStep(m,.01);assert.equal(m.decoy,null);assert.equal(m.state,'SEARCHING');assert.equal(m.alive,true);
});
test('altitude, damage and load alter caps; acceleration and G-bounded turns are finite',()=>{
  for(const type of Object.keys(AIRCRAFT)){
    const a=plane(type);a.z=1;const low=aircraftSpeedCap(a);a.z=a.profile.referenceAltitude/1000;const high=aircraftSpeedCap(a);assert.ok(high>low);assert.ok(high<=a.profile.maxSpeed/3600);
    a.health=50;assert.ok(aircraftSpeedCap(a)<high);a.health=100;a.speed=.2;const v=a.speed;flyAircraft(a,0,.1);assert.ok(a.speed-v<=AI_DEFAULTS.acceleration*.1+.000001);
    a.angle=0;a.ai.state='DEFENSIVE';a.ai.primary={priority:2};a.ai.maneuver={angle:Math.PI,altitude:a.z};
    for(let i=0;i<200;i++){flyAircraft(a,i*.05,.05);assert.ok(a.actualG<=a.profile.commandedG+.00001);assert.ok(a.actualG<=a.profile.structuralG);assert.ok(a.z<=a.profile.ceiling/1000);}
  }
});
test('terrain recovery outranks threat turn and damaged aircraft never resume attacks',()=>{
  const a=plane();a.z=.6;warn(a,'ACTIVE_SEEKER');decideAircraft(a,3);const h=a.z;flyAircraft(a,3,.2);assert.ok(a.z>h);
  a.health=34;decideAircraft(a,4);assert.ok(a.retreat);assert.equal(a.ai.state,'DISENGAGE');a.perception.warnings.clear();decideAircraft(a,40);assert.equal(a.ai.state,'DISENGAGE');
});
test('WP-0 intrusion is meaningful, completes route, and exits without weapons or reappearing',()=>{
  const a=plane('MiG-25');decideAircraft(a,10);assert.equal(a.ai.state,'MISSION APPROACH');assert.equal(a.retreat,false);assert.equal(a.ordnance,0);
  Object.assign(a,a.mission.intrusion);flyAircraft(a,10,.1);assert.equal(a.ai.state,'DISENGAGE');assert.equal(a.retreat,true);
  a.x=AI_DEFAULTS.exitRadius+1;a.y=0;flyAircraft(a,11,.1);assert.equal(a.ai.state,'EXITED');assert.equal(a.alive,false);decideAircraft(a,12);assert.equal(a.alive,false);
});
test('two interrupted attack runs cause permanent mission abort',()=>{
  const a=plane();transition(a,'ATTACK RUN',1);transition(a,'DEFENSIVE',2);assert.equal(a.ai.failedRuns,1);
  transition(a,'ATTACK RUN',10);transition(a,'MISSILE EVASION',11);decideAircraft(a,12);assert.equal(a.ai.failedRuns,2);assert.equal(a.ai.state,'DISENGAGE');
});
test('bombs release from valid trajectory, remain airborne after carrier destruction, and impact later',()=>{
  const s=sim(),a=s.spawn(0,{preset:'WP-1',routeVariation:false});s.radar=false;a.rwr={...RWR_TIERS[0]};a.cfg.visualRange=0;
  Object.assign(a,{x:0,y:-5,z:2.5,speed:.2,angle:Math.PI/2,verticalSpeed:0});
  const t=Math.sqrt(2*a.z/AI_DEFAULTS.bombGravity);a.y=-a.speed*t;transition(a,'ATTACK RUN',0);a.ai.nextDecision=100;
  a.releaseStableFor=a.cfg.bombStableDwell;assert.ok(releaseSolution(a).valid);s.step(.05);assert.equal(s.aviation.bombs.length,1);assert.equal(s.hits,0);assert.equal(a.ordnance,3);
  a.alive=false;a.ai.state='DESTROYED';s.step(t-1);assert.equal(s.hits,0);s.step(2);assert.equal(s.hits,1);assert.equal(s.aviation.bombs.length,0);
});
test('search caution permits a close mission release; no instant battery hit on overflight',()=>{
  const s=sim(),a=s.spawn(0,{preset:'WP-1',routeVariation:false});Object.assign(a,{x:0,y:-4,z:2.5,speed:.24,angle:Math.PI/2});warn(a,'SEARCH');decideAircraft(a,.71);decideAircraft(a,5);
  assert.equal(a.ai.state,'ATTACK RUN');s.radar=false;s.step(.1);assert.equal(s.hits,0);
});
test('traces are development-only and all sensing, reactions, flight and decoys use simulation time',()=>{
  const s=sim({aviation:{trace:true}});s.spawn();s.step(12);assert.ok(s.aviation.trace.length);assert.ok(!s.log.some(e=>/EVIDENCE|DECISION|CAUTIOUS/.test(e.message)));
  const snapshot=JSON.stringify({time:s.time,aircraft:s.aircraft.map(a=>({x:a.x,ai:a.ai,cm:a.cm,perception:[...a.perception.warnings.values()]})),decoys:s.aviation.decoys});
  s.step(0);assert.equal(JSON.stringify({time:s.time,aircraft:s.aircraft.map(a=>({x:a.x,ai:a.ai,cm:a.cm,perception:[...a.perception.warnings.values()]})),decoys:s.aviation.decoys}),snapshot);
  const normal=sim();assert.equal(normal.aviation.trace,null);
});

test('unopposed bomb exercise reaches delayed impacts even with continuing search warnings',()=>{
  const s=new Simulation({hostileMissilesEnabled:false});s.step(720);assert.equal(s.hits,4);assert.ok(s.time>100);assert.ok(s.log.some(e=>e.message.includes('Bomb impact')));assert.equal(s.fired,0);
});

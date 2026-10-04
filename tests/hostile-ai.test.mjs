import test from 'node:test';
import assert from 'node:assert/strict';
import {createAircraft,decideAircraft,flyAircraft,AircraftSystems,angleDelta,achievableG,transition} from '../web/aviation.js';
import {RWR_TIERS,WEAPON_PRESETS} from '../web/aircraft-config.js';
import {HostileWeapons} from '../web/hostile-weapons.js';

const position={x:0,y:-180,z:8};
const plane=(settings={},seed=7,type='Su-27')=>createAircraft(type,'C1',position,{rwr:RWR_TIERS[0],routeVariation:true,...settings},seed);
function harness(settings={},type='Su-27'){
  const sim={cfg:{seed:7,maxPlayerHits:4},serial:1,time:0,radar:false,aircraft:[],missiles:[],contacts:new Map(),effects:[],hits:0,
    removeContact(){},usable(){return false;},addLog(){}};
  const aviation=new AircraftSystems(sim);sim.aviation=aviation;
  const a=aviation.create(type,'C1',position,{preset:'WP-3',routeVariation:true,rwr:RWR_TIERS[0],missionProfile:'STANDOFF STRIKE',...settings});
  sim.aircraft.push(a);sim.launched=[];
  sim.hostileWeapons={
    profile(){return {minRange:15,launchRange:140,standoffRange:110};},
    canLaunch(a){const r=Math.hypot(a.x,a.y),angle=Math.atan2(-a.y,-a.x);return a.missileAttackAuthorized&&a.missilesRemaining>0&&sim.time>=a.missileReady&&r>=15&&r<=140&&Math.abs(angleDelta(angle,a.angle))<=24*Math.PI/180;},
    launch(a){if(!this.canLaunch(a))return null;const m={id:'H'+(sim.launched.length+1),x:a.x,y:a.y,z:a.z};a.missilesRemaining--;a.missileReady=sim.time+14;sim.launched.push(m);return m;}
  };
  return {sim,aviation,a};
}
function advance(h,seconds){for(let elapsed=0;elapsed<seconds;elapsed+=.05){h.sim.time+=.05;h.aviation.tick(.05);}}

test('WP3 carriers have finite missile inventories and MiG25 stays unarmed',()=>{
  assert.equal(WEAPON_PRESETS['WP-3'].enabled,true);
  for(const type of ['Su-27','MiG-29','Tu-160']){
    const a=plane({preset:'WP-3'},7,type);assert.ok(a.missilesRemaining>0);assert.equal(a.ordnance,0);assert.ok(a.missileWeaponID);assert.equal(a.mission.task,'STANDOFF MISSILE STRIKE');
  }
  const diversion=plane({preset:'WP-0'},7,'MiG-25');assert.equal(diversion.missilesRemaining,0);assert.equal(diversion.ordnance,0);
  assert.throws(()=>plane({preset:'WP-3'},7,'MiG-25'),/Unsupported weapon preset/);
});

test('seeded profiles choose stable varied doglegs, launch bearings and altitudes',()=>{
  const a=plane({preset:'WP-3'},22),b=plane({preset:'WP-3'},22);
  assert.deepEqual(a.mission,b.mission);assert.equal(a.angle,b.angle);
  const profiles=new Set(),bearings=new Set();
  for(let seed=1;seed<=32;seed++){
    const carrier=plane({preset:'WP-3'},seed);profiles.add(carrier.mission.profile);bearings.add(carrier.mission.approachAngle);
    assert.notEqual(carrier.mission.attackPoint.x,0);assert.ok(carrier.mission.approachAltitude>=carrier.cfg.safeAltitude);
    const bomber=plane({preset:'WP-1'},seed);assert.ok(bomber.mission.route.length>=2);assert.notEqual(bomber.mission.route[0].x,0);
  }
  assert.equal(profiles.size,2);assert.ok(bearings.size>20);
});

test('standoff carrier changes its route, launches outside the battery, then egresses with unused inventory',()=>{
  const h=harness(),initial=h.a.angle;advance(h,600);
  assert.equal(h.sim.launched.length,1);const m=h.sim.launched[0];
  assert.ok(Math.hypot(m.x,m.y)>80,'Carrier must release from standoff range rather than overfly');
  assert.ok(Math.hypot(m.x,m.y)<=140);assert.equal(h.a.missilesRemaining,1);assert.equal(h.a.missilesFired,1);assert.equal(h.a.retreat,true);
  assert.equal(h.a.missileAttackAuthorized,false);assert.notEqual(h.a.angle,initial);
  advance(h,100);assert.equal(h.sim.launched.length,1);
});

test('an optional two-round salvo obeys cooldown and leaves after its planned count',()=>{
  const h=harness({missileSalvoLimit:2});advance(h,600);
  assert.equal(h.sim.launched.length,2);assert.equal(h.a.missilesRemaining,0);assert.equal(h.a.missilesFired,2);assert.equal(h.a.retreat,true);
});

test('aircraft launch windows integrate with real hostile solution dwell and delayed missile flight',()=>{
  for(const type of ['MiG-29','Tu-160']){
    const h=harness({},type),weapons=new HostileWeapons(h.sim);h.sim.hostileWeapons=weapons;
    const released=[];const original=weapons.launch.bind(weapons);weapons.launch=a=>{const m=original(a);if(m)released.push({time:h.sim.time,range:Math.hypot(m.x,m.y),stable:a.missileStableFor});return m;};
    for(let i=0;i<20000&&h.sim.hits===0;i++){h.sim.time+=.05;h.aviation.tick(.05);weapons.tick(.05);}
    assert.equal(released.length,1,type+' should complete a launch solution');assert.ok(released[0].range>15);
    assert.equal(h.sim.hits,1,type+' missile should fly to the objective');assert.ok(h.sim.time>released[0].time+10);
    assert.equal(h.a.retreat,true);assert.equal(h.a.missilesFired,1);
  }
});

test('lock evidence cancels missile authorization after reaction; hidden player selections do not',()=>{
  const a=plane({preset:'WP-3',routeVariation:false});Object.assign(a,{x:0,y:-110,z:6,angle:Math.PI/2});decideAircraft(a,0);
  assert.equal(a.ai.state,'LAUNCH WINDOW');assert.equal(a.missileAttackAuthorized,true);
  a.selectedByPlayer=true;a.playerTrackQuality=1;a.playerPreparingFire=true;decideAircraft(a,.1);assert.equal(a.missileAttackAuthorized,true);
  a.perception.warnings.set('FC',{id:'FC',episode:1,class:'FIRE CONTROL',priority:2,confidence:.8,bearing:0,time:.1,expires:8});decideAircraft(a,.2);
  const ready=a.ai.pending.ready;assert.ok(ready>.2);decideAircraft(a,ready);
  assert.equal(a.ai.state,'DEFENSIVE');assert.equal(a.missileAttackAuthorized,false);assert.equal(a.ai.failedRuns,1);
});

test('search evidence permits a held missile launch window without state churn',()=>{
  const a=plane({preset:'WP-3',routeVariation:false});Object.assign(a,{x:0,y:-110,z:6,angle:Math.PI/2});
  a.perception.warnings.set('search',{id:'search',episode:1,class:'SEARCH',priority:1,confidence:.7,bearing:0,time:0,expires:8});
  decideAircraft(a,0);decideAircraft(a,a.ai.pending.ready);const entered=a.ai.stateSince;
  for(let time=a.ai.pending.ready+.25;time<8;time+=.25){decideAircraft(a,time);assert.equal(a.ai.state,'LAUNCH WINDOW');assert.equal(a.ai.stateSince,entered);assert.equal(a.missileAttackAuthorized,true);}
});

test('cleared defense uses remembered warning direction for a new route and preserves the retry limit',()=>{
  const a=plane({preset:'WP-3',routeVariation:false});Object.assign(a,{x:0,y:-110,z:6,angle:Math.PI/2});decideAircraft(a,0);
  const original={...a.mission.attackPoint},originalAngle=a.mission.approachAngle;
  a.perception.warnings.set('FC',{id:'FC',episode:1,class:'FIRE CONTROL',priority:2,confidence:.65,bearing:10,time:0,expires:8});
  decideAircraft(a,.1);decideAircraft(a,a.ai.pending.ready);assert.equal(a.ai.failedRuns,1);
  a.perception.warnings.clear();decideAircraft(a,9);decideAircraft(a,15.1);assert.equal(a.ai.state,'REASSESS');decideAircraft(a,17.2);
  assert.equal(a.ai.state,'MISSION APPROACH');assert.ok(a.mission.reapproach);assert.notEqual(a.mission.approachAngle,originalAngle);assert.notDeepEqual(a.mission.attackPoint,original);
  assert.equal(a.ai.dangerousApproaches.at(-1).bearing,10);assert.equal(a.ai.dangerousApproaches.at(-1).confidence,.65);
  assert.ok(Math.abs(Math.hypot(a.mission.reapproach.x,a.mission.reapproach.y)-a.mission.standoffRange)<1e-8);
  transition(a,'LAUNCH WINDOW',18);a.ai.primary={bearing:20,confidence:.8};transition(a,'MISSILE EVASION',19);decideAircraft(a,20);
  assert.equal(a.ai.failedRuns,2);assert.equal(a.ai.state,'DISENGAGE');assert.equal(a.missileAttackAuthorized,false);
});

test('background SEARCH cannot skip acute-defense cooldown or remembered-route reassessment',()=>{
  const a=plane({preset:'WP-3',routeVariation:false});Object.assign(a,{x:0,y:-110,z:6,angle:Math.PI/2});decideAircraft(a,0);
  a.perception.warnings.set('FC',{id:'FC',episode:1,class:'FIRE CONTROL',priority:2,confidence:.8,bearing:0,time:0,expires:8});
  decideAircraft(a,.1);decideAircraft(a,a.ai.pending.ready);const maneuver=a.ai.maneuver;
  a.perception.warnings.delete('FC');a.perception.warnings.set('search',{id:'search',episode:2,class:'SEARCH',priority:1,confidence:.7,bearing:0,time:9,expires:50});
  decideAircraft(a,9);decideAircraft(a,14.9);assert.equal(a.ai.state,'DEFENSIVE');assert.equal(a.missileAttackAuthorized,false);assert.equal(a.ai.maneuver,maneuver);
  // The held escape turn remains active even though the current strongest cue
  // is only SEARCH; it does not immediately turn back into the launch point.
  a.angle=maneuver.angle;const before=a.angle;flyAircraft(a,14.9,.1);assert.equal(a.angle,before);
  decideAircraft(a,15.1);assert.equal(a.ai.state,'REASSESS');assert.equal(a.missileAttackAuthorized,false);
  decideAircraft(a,16.9);assert.equal(a.ai.state,'REASSESS');decideAircraft(a,17.2);
  assert.ok(['MISSION APPROACH','CAUTIOUS'].includes(a.ai.state));assert.ok(a.mission.reapproach);assert.equal(a.missileAttackAuthorized,false);
});

test('unavailable launch solutions cause bounded repositioning and mission abort',()=>{
  const h=harness();h.sim.hostileWeapons.canLaunch=()=>false;advance(h,1500);
  assert.equal(h.sim.launched.length,0);assert.equal(h.a.retreat,true);assert.ok(h.a.ai.failedRuns>=2||h.sim.time-h.a.mission.startedAt>=h.a.cfg.missionMaxSeconds);
});

test('diversion crosses an offset waypoint while attack flight remains G and altitude bounded',()=>{
  const a=plane({preset:'WP-0'},21,'MiG-25');assert.notEqual(a.mission.intrusion.x,0);assert.equal(a.mission.task,'INTRUSION / DIVERSION');
  for(let i=0;i<1000;i++){
    if(i%5===0)decideAircraft(a,i*.1);flyAircraft(a,i*.1,.1);
    assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y)&&Number.isFinite(a.z));assert.ok(a.actualG<=a.profile.structuralG+1e-8);assert.ok(a.actualG<=a.profile.commandedG+1e-8);
    assert.ok(a.z>=a.cfg.safeAltitude&&a.z<=a.profile.ceiling/1000);assert.ok(achievableG(a)<=a.profile.commandedG);
  }
  transition(a,'DISENGAGE',101);decideAircraft(a,102);assert.equal(a.missileAttackAuthorized,false);
});

test('per-aircraft configured mission time ends an endlessly interrupted attack',()=>{
  const a=plane({preset:'WP-3',missionMaxSeconds:20});decideAircraft(a,5);decideAircraft(a,25);
  assert.equal(a.ai.state,'DISENGAGE');assert.equal(a.retreat,true);assert.equal(a.missileAttackAuthorized,false);
});

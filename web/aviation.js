import {AIRCRAFT,RWR_PROFILES,RWR_TIERS,AI_DEFAULTS} from './aircraft-config.js';

export const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const rad=v=>v*Math.PI/180;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
const heading=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
const bearing=angle=>(angle*180/Math.PI+90+360)%360;
export function seeded(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

export function createAircraft(type,id,position,settings={},seed=1){
  const profile=AIRCRAFT[type];
  if(!profile)throw Error('Unsupported aircraft '+type);
  const cfg={...AI_DEFAULTS,...settings};
  const rng=seeded(seed);
  const exitAngle=heading({x:0,y:0},position)+Math.PI;
  const mission={objective:{x:0,y:0,z:0},exit:{x:Math.cos(exitAngle)*cfg.exitRadius,y:Math.sin(exitAngle)*cfg.exitRadius,z:10},intrusion:{x:-position.x*.5,y:-position.y*.5,z:position.z}};
  const a={id,type,profile,allegiance:'HOSTILE',...position,angle:heading(position,mission.objective),
    speed:0,health:100,alive:true,retreat:false,exited:false,actualG:1,maxCommandedG:profile.commandedG,
    verticalSpeed:0,heat:1,signature:profile.signature,stealth:profile.stealth,
    preset:settings.preset||profile.presets[0],ordnance:settings.preset==='WP-0'?0:profile.bombs,cm:profile.countermeasures,cmReady:0,bombReady:0,
    rwr:{...RWR_PROFILES[profile.rwr],...settings.rwr},maws:cfg.maws,mission,rng,
    perception:{warnings:new Map(),pending:new Map(),observed:new Map(),visualDwell:new Map(),emitterAliases:new Map(),visualAliases:new Map(),nextEmitter:0,nextVisual:0},
    ai:{state:'MISSION APPROACH',stateSince:0,nextDecision:0,pending:null,clearSince:null,
      failedRuns:0,wasAttacking:false,primary:null,maneuver:null,riskSince:null},cfg};
  if(!profile.presets.includes(a.preset))throw Error('Unsupported weapon preset '+a.preset+' for '+type);
  a.speed=aircraftSpeedCap(a)*cfg.initialCruise;
  return a;
}

export function aircraftSpeedCap(a){
  const p=a.profile,altitude=Math.min(a.z*1000,p.referenceAltitude);
  const base=(p.lowSpeed+(p.maxSpeed-p.lowSpeed)*clamp(altitude/p.referenceAltitude,0,1))/3600;
  const healthFactor=.5+.5*clamp(a.health/100,0,1);
  const loadFactor=1-.08*(a.profile.bombs?a.ordnance/a.profile.bombs:0);
  return base*healthFactor*loadFactor;
}

export function achievableG(a){
  const cap=aircraftSpeedCap(a),energy=clamp(a.speed/Math.max(cap,.01),.15,1);
  return Math.min(a.profile.structuralG,a.profile.commandedG,
    1+(a.profile.commandedG-1)*Math.min(1,energy*energy*1.35)*(.4+.6*clamp(a.health/100,0,1)));
}

export function canReceive(a,e,time,lineOfSight=()=>true){
  const p=a.rwr;
  if(!p||p.generation===0||!p.bands.includes(e.band)||!p.waveforms.includes(e.waveform))return false;
  const d=distance(a,e),az=heading(a,e),elevation=Math.atan2((e.z||0)-a.z,Math.hypot(e.x-a.x,e.y-a.y));
  if(Math.abs(angleDelta(az,a.angle))>rad(p.horizontal/2)||Math.abs(elevation)>rad(p.vertical/2))return false;
  if(!lineOfSight(a,e,time))return false;
  if(e.beam!==undefined&&Math.abs(angleDelta(heading(e,a),e.angle))>rad(e.beam/2))return false;
  return e.strength/(1+(d/100)**2)>=p.sensitivity;
}

function classify(p,e,rng){
  const known=p.library.includes(e.family);
  if(!known||rng()<p.ambiguousChance)return {class:'UNKNOWN EMITTER',confidence:.4,priority:1};
  if(e.waveform==='ACTIVE_SEEKER'&&p.seeker)return {class:'MISSILE SEEKER',confidence:.85,priority:3};
  if(e.waveform==='ILLUMINATION'&&p.illumination)return {class:'ILLUMINATION',confidence:.8,priority:3};
  if((e.waveform==='FIRE_CONTROL'||e.waveform==='ILLUMINATION')&&p.fireControl)return {class:'FIRE CONTROL',confidence:.75,priority:2};
  if((e.waveform==='SEARCH'||e.waveform==='PULSE_DOPPLER')&&p.search)return {class:'SEARCH',confidence:.7,priority:1};
  return {class:'UNKNOWN EMITTER',confidence:.4,priority:1};
}

export function receiveEmissions(a,emissions,time,lineOfSight){
  const sense=a.perception,p=a.rwr;
  for(const e of emissions){
    if(!canReceive(a,e,time,lineOfSight)||a.rng()<p.missChance)continue;
    let alias=sense.emitterAliases.get(e.key);
    if(!alias){alias='RX-'+(++sense.nextEmitter);sense.emitterAliases.set(e.key,alias);}
    const reading=classify(p,e,a.rng);
    let b=bearing(heading(a,e));
    b=p.sectors?((Math.round(b/(360/p.sectors))*(360/p.sectors))%360):((b+(a.rng()*2-1)*p.bearingError+360)%360);
    const received={id:alias,...reading,bearing:b,time,source:'RWR'};
    const current=sense.warnings.get(alias);
    if(current&&current.class===reading.class){sense.warnings.set(alias,{...received,expires:time+p.memory});continue;}
    const pending=sense.pending.get(alias);
    if(!pending||pending.class!==reading.class)sense.pending.set(alias,{...received,ready:time+p.delay,lastReceived:time});
    else Object.assign(pending,{lastReceived:time,bearing:b,confidence:reading.confidence});
  }
  for(const [id,w]of sense.pending){
    if(time>=w.ready){sense.warnings.set(id,{id:w.id,class:w.class,confidence:w.confidence,priority:w.priority,bearing:w.bearing,time:w.lastReceived,source:'RWR',expires:w.lastReceived+p.memory});sense.pending.delete(id);}
  }
  for(const [id,w]of sense.warnings)if(time>w.expires)sense.warnings.delete(id);
  if(sense.warnings.size>p.capacity){const sorted=[...sense.warnings.values()].sort((a,b)=>b.priority-a.priority||b.time-a.time);sense.warnings=new Map(sorted.slice(0,p.capacity).map(w=>[w.id,w]));}
}

export function observeMissiles(a,missiles,time,dt,lineOfSight=()=>true){
  const cfg=a.cfg,sense=a.perception;
  for(const m of missiles){
    if(!m.alive)continue;
    const d=distance(a,m),az=heading(a,m),elevation=Math.atan2(m.z-a.z,Math.hypot(m.x-a.x,m.y-a.y));
    const visual=d<=cfg.visualRange*cfg.visualWeather*cfg.nightPenalty&&Math.abs(angleDelta(az,a.angle))<=rad(cfg.visualFov/2)&&Math.abs(elevation)<=rad(cfg.visualVertical/2)&&lineOfSight(a,m,time);
    const maws=a.maws&&d<=cfg.visualRange*1.5&&lineOfSight(a,m,time);
    if(!visual&&!maws){sense.visualDwell.delete(m.id);continue;}
    const dwell=(sense.visualDwell.get(m.id)||0)+dt;sense.visualDwell.set(m.id,dwell);
    if(!maws&&dwell<cfg.visualAcquire)continue;
    let alias=sense.visualAliases.get(m.id);if(!alias){alias='OBS-'+(++sense.nextVisual);sense.visualAliases.set(m.id,alias);}
    const previous=sense.observed.get(alias),measuredRange=d*(.8+.4*a.rng()),b=(bearing(az)+(a.rng()*2-1)*8+360)%360;
    let closing=null,tti=null;
    if(previous&&time>previous.time){closing=(previous.rangeEstimate-measuredRange)/(time-previous.time);if(closing>.02)tti=clamp(measuredRange/closing,0,120);}
    sense.observed.set(alias,{id:alias,class:'OBSERVED MISSILE',source:maws?'MAWS':'VISUAL',priority:4,confidence:.8,bearing:b,rangeEstimate:measuredRange,closingEstimate:closing,timeToImpactEstimate:tti,time,expires:time+cfg.missileMemory,guidance:'UNKNOWN'});
  }
  for(const [id,o]of sense.observed)if(time>o.expires)sense.observed.delete(id);
}

export function perceivedThreats(a){
  // This is the sole threat input to decisions: no global missile positions,
  // player target selection, tracking, ammunition, lock ID or channel counts.
  return [...a.perception.warnings.values(),...a.perception.observed.values()]
    .sort((x,y)=>y.priority-x.priority||(x.timeToImpactEstimate??Infinity)-(y.timeToImpactEstimate??Infinity)||y.confidence-x.confidence);
}

function trace(a,time,entries,event,extra={}){if(entries){entries.push({time,aircraft:a.id,event,state:a.ai.state,warning:a.ai.primary?{id:a.ai.primary.id,class:a.ai.primary.class,bearing:a.ai.primary.bearing,confidence:a.ai.primary.confidence}:null,delay:a.ai.pending?Math.max(0,a.ai.pending.ready-time):0,maneuver:a.ai.maneuver?.kind||null,countermeasures:a.cm,...extra});if(entries.length>2000)entries.shift();}}

export function transition(a,state,time,entries,reason){
  if(a.ai.state===state)return false;
  if(a.ai.state==='ATTACK RUN'&&(state==='DEFENSIVE'||state==='MISSILE EVASION'))a.ai.failedRuns++;
  a.ai.state=state;a.ai.stateSince=time;
  if(state==='DISENGAGE'){a.retreat=true;a.ai.pending=null;}
  trace(a,time,entries,'STATE',{reason});return true;
}

function defensiveManeuver(a,threats,time){
  const primary=threats[0],side=a.rng()<.5?-1:1;
  // Bearing-only policy. For multiple threats, choose a circular mean heading
  // away from their weighted bearings; there is no access to true ranges.
  const incoming=threats.filter(t=>t.priority>=2);
  let away=(primary.bearing-90)*Math.PI/180+Math.PI;
  if(incoming.length>1){let x=0,y=0;for(const t of incoming){const b=(t.bearing-90)*Math.PI/180;x+=Math.cos(b)*t.priority;y+=Math.sin(b)*t.priority;}if(Math.hypot(x,y)>.05)away=Math.atan2(y,x)+Math.PI;}
  const beam=(primary.bearing-90)*Math.PI/180+side*Math.PI/2;
  const useBeam=a.rng()<a.cfg.skill*.45&&primary.class==='FIRE CONTROL';
  a.ai.maneuver={kind:useBeam?'BEAM ATTEMPT':'SEPARATION TURN',angle:useBeam?beam:away+side*rad((1-a.cfg.skill)*20),altitude:Math.max(a.cfg.safeAltitude,a.z-(a.profile.maneuver>3?.8:.2)),heldUntil:time+Math.max(4,a.cfg.stateHold),side};
}

export function decideAircraft(a,time,entries=null){
  if(!a.alive||a.exited)return;
  const ai=a.ai,cfg=a.cfg,threats=perceivedThreats(a),primary=threats[0]||null;
  ai.primary=primary;
  if(a.health<cfg.abortHealth||a.health<20||ai.failedRuns>=cfg.failedApproaches||a.preset!=='WP-0'&&a.ordnance<=0){transition(a,'DISENGAGE',time,entries,'condition, weapons, or failed approaches');}
  if(a.z<=cfg.safeAltitude+.01){ai.maneuver={kind:'TERRAIN AVOIDANCE',angle:a.angle,altitude:cfg.safeAltitude+.5,heldUntil:time+2};trace(a,time,entries,'TERRAIN');return;}
  if(primary){
    ai.clearSince=null;
    if(ai.riskSince===null)ai.riskSince=time;
    const urgency=primary.priority;
    const pending=ai.pending;
    // A new more urgent signal interrupts an older caution timer once.
    if(!pending||urgency>pending.priority){
      const emergency=urgency>=3;
      const delay=emergency?cfg.emergencyMin+a.rng()*(cfg.emergencyMax-cfg.emergencyMin):cfg.reactionMin+a.rng()*(cfg.reactionMax-cfg.reactionMin);
      ai.pending={id:primary.id,priority:urgency,ready:time+delay,acted:false};
      trace(a,time,entries,'EVIDENCE',{evidence:threats.map(t=>({id:t.id,class:t.class,source:t.source,confidence:t.confidence}))});
    }
    if(time>=ai.pending.ready){
      const oldPriority=ai.state==='MISSILE EVASION'?3:ai.state==='DEFENSIVE'?2:ai.state==='CAUTIOUS'?1:0;
      const mayChange=time-ai.stateSince>=cfg.stateHold||urgency>oldPriority;
      const state=urgency>=3?'MISSILE EVASION':urgency===2?'DEFENSIVE':'CAUTIOUS';
      if(ai.state!=='DISENGAGE'&&mayChange){
        // High aggression can finish a briefly available release solution,
        // never grant immunity or ignore damage/flight constraints.
        const finishing=ai.state==='ATTACK RUN'&&(urgency===1||urgency===2&&a.cfg.aggression>.7&&a.health>75);
        if(!finishing)transition(a,state,time,entries,'perceived '+primary.class);
      }
      if(urgency>=2&&(ai.state!=='CAUTIOUS')&&(!ai.maneuver||time>=ai.maneuver.heldUntil))defensiveManeuver(a,threats,time);
      if(urgency===1&&!ai.maneuver)ai.maneuver={kind:'CAUTIOUS OFFSET',angle:a.angle+(a.rng()<.5?-1:1)*rad(7),altitude:a.z,heldUntil:time+6};
      ai.pending.acted=true;
    }
    if(primary.priority>=2&&time-ai.riskSince>cfg.riskAbortSeconds&&(cfg.aggression<.4||a.cm===0))transition(a,'DISENGAGE',time,entries,'accumulated mission risk');
  }else{
    ai.riskSince=null;
    if(ai.clearSince===null)ai.clearSince=time;
    if(ai.state!=='DISENGAGE'&&['CAUTIOUS','DEFENSIVE','MISSILE EVASION'].includes(ai.state)&&time-ai.clearSince>=cfg.safeClear&&time-ai.stateSince>=cfg.stateHold){transition(a,'REASSESS',time,entries,'warnings and observed missile memory cleared');ai.pending=null;ai.maneuver=null;}
    else if(ai.state==='REASSESS'&&time-ai.stateSince>=cfg.stateHold){transition(a,'MISSION APPROACH',time,entries,'retry eligible');ai.maneuver=null;}
    if(ai.state==='MISSION APPROACH'&&a.preset==='WP-1'&&Math.hypot(a.x,a.y)<=cfg.attackEntry)transition(a,'ATTACK RUN',time,entries,'mission approach complete');
  }
  if(!a.retreat&&['MISSION APPROACH','CAUTIOUS'].includes(ai.state)&&a.preset==='WP-1'&&!a.mission.reapproach&&Math.hypot(a.x,a.y)<=cfg.attackEntry&&(!primary||primary.priority<2))transition(a,'ATTACK RUN',time,entries,'release approach despite manageable search evidence');
  if(ai.state==='ATTACK RUN'&&Math.hypot(a.x,a.y)>8&&Math.abs(angleDelta(heading(a,a.mission.objective),a.angle))>rad(110)){
    ai.failedRuns++;a.mission.reapproach={x:a.x+Math.cos(a.angle)*25,y:a.y+Math.sin(a.angle)*25,z:cfg.bombAltitude};transition(a,ai.failedRuns>=cfg.failedApproaches?'DISENGAGE':'REASSESS',time,entries,'missed release approach');
  }
  trace(a,time,entries,'DECISION');
}

export function deployCountermeasures(a,time,decoys,entries=null){
  const threat=a.ai.primary,cfg=a.cfg;
  if(!threat||threat.priority<3||time<a.cmReady||a.cm<=0||time<(a.ai.pending?.ready??Infinity))return false;
  const reserve=Math.ceil(a.profile.countermeasures*cfg.cmReserve),emergency=threat.priority>=4||threat.class==='MISSILE SEEKER';
  if(!emergency&&a.cm-cfg.cmBurst<reserve)return false;
  const count=Math.min(cfg.cmBurst,a.cm);a.cm-=count;a.cmReady=time+cfg.cmCooldown;
  decoys.push({id:'CM-'+a.id+'-'+time.toFixed(2),owner:a.id,x:a.x,y:a.y,z:a.z,born:time,expires:time+cfg.cmLifetime,radar:true,heat:true,angle:a.angle,alive:true});
  trace(a,time,entries,'COUNTERMEASURES',{spent:count});return true;
}

export function releaseSolution(a){
  const cfg=a.cfg,h=a.z-cfg.terrainHeight;
  if(h<=0)return null;
  const flightTime=(a.verticalSpeed+Math.sqrt(a.verticalSpeed*a.verticalSpeed+2*cfg.bombGravity*h))/cfg.bombGravity;
  const point={x:a.x+Math.cos(a.angle)*a.speed*flightTime,y:a.y+Math.sin(a.angle)*a.speed*flightTime};
  const error=Math.hypot(point.x-a.mission.objective.x,point.y-a.mission.objective.y);
  const headingError=Math.abs(angleDelta(heading(a,a.mission.objective),a.angle));
  return {flightTime,point,error,valid:error<=cfg.bombReleaseRadius&&headingError<=rad(cfg.bombHeadingTolerance)};
}

export function flyAircraft(a,time,dt){
  const cfg=a.cfg,ai=a.ai;
  let goal=a.retreat?a.mission.exit:a.mission.reapproach|| (a.preset==='WP-0'?a.mission.intrusion:a.mission.objective);
  if(!a.retreat&&a.mission.reapproach&&distance(a,goal)<2){a.mission.reapproach=null;transition(a,'MISSION APPROACH',time,null,'reapproach waypoint reached');goal=a.mission.objective;}
  if(a.preset==='WP-0'&&!a.retreat&&distance(a,goal)<cfg.intrusionWaypointRadius){transition(a,'DISENGAGE',time,null,'intrusion route complete');goal=a.mission.exit;}
  let desired=heading(a,goal),altitude=a.retreat?Math.min(a.profile.ceiling/1000,10):a.preset==='WP-0'?a.z:cfg.bombAltitude;
  if(ai.maneuver?.kind==='TERRAIN AVOIDANCE'&&time<ai.maneuver.heldUntil){desired=ai.maneuver.angle;altitude=ai.maneuver.altitude;}
  else if(ai.maneuver&&['DEFENSIVE','MISSILE EVASION','DISENGAGE'].includes(ai.state)&&ai.primary?.priority>=2){desired=ai.maneuver.angle;altitude=ai.maneuver.altitude;}
  else if(ai.state==='CAUTIOUS'&&ai.maneuver&&time<ai.maneuver.heldUntil)desired+=ai.maneuver.side?ai.maneuver.side*rad(7):rad(7);
  const cap=aircraftSpeedCap(a),g=achievableG(a),v=Math.max(a.speed,cfg.minimumSpeed);
  const structuralTurn=.00981*Math.sqrt(Math.max(0,g*g-1))/v;
  const handling=clamp(.35+a.profile.maneuver*.065,.4,1);
  const turn=clamp(angleDelta(desired,a.angle),-structuralTurn*handling*dt,structuralTurn*handling*dt);
  a.angle+=turn;
  a.actualG=Math.min(a.profile.structuralG,Math.sqrt(1+(v*Math.abs(turn)/(Math.max(dt,.001)*.00981))**2));
  a.maxCommandedG=g;
  a.heat=ai.state==='MISSILE EVASION'&&ai.primary?.guidance==='IR'?cfg.heatReduction:1;
  const acceleration=cfg.acceleration*(.3+.7*a.health/100)*(a.heat<1?1-cfg.heatEnergyPenalty:1);
  const loss=cfg.turnEnergyLoss*(a.actualG-1)**2/(.5+a.profile.maneuver/10);
  a.speed=Math.max(cfg.minimumSpeed,a.speed>cap?Math.max(cap,a.speed-(cfg.deceleration+loss)*dt):Math.min(cap,a.speed+acceleration*dt-loss*dt));
  const climb=clamp(altitude-a.z,-cfg.climbRate*dt,cfg.climbRate*dt);
  a.verticalSpeed=climb/dt;a.z=clamp(a.z+climb,cfg.safeAltitude,a.profile.ceiling/1000);
  a.x+=Math.cos(a.angle)*a.speed*dt;a.y+=Math.sin(a.angle)*a.speed*dt;
  if(a.retreat&&Math.hypot(a.x,a.y)>cfg.exitRadius){a.exited=true;a.alive=false;ai.state='EXITED';}
}

export class AircraftSystems {
  constructor(sim,settings={}){this.sim=sim;this.cfg={...AI_DEFAULTS,...settings};this.nextSensor=0;this.trace=settings.trace?[]:null;this.decoys=[];this.bombs=[];this.bombSerial=0;this.lineOfSight=settings.lineOfSight||(()=>true);}
  create(type,id,position){const overrides={...this.cfg,aggression:AIRCRAFT[type].aggression,...this.cfg.aircraftOverrides?.[type]};return createAircraft(type,id,position,overrides,this.sim.cfg.seed+this.sim.serial*7919);}
  emissions(){
    const s=this.sim,cfg=this.cfg,output=[];
    if(s.radar){output.push({key:'battery-search',x:0,y:0,z:0,angle:s.phase-Math.PI/2,beam:cfg.searchBeam,band:cfg.emissionBand,waveform:'SEARCH',family:'BETA_SEARCH',strength:cfg.searchStrength});
      const lock=s.contacts.get(s.locked);
      if(s.usable(lock)){const p=s.estimate(lock);const illuminating=s.missiles.some(m=>m.alive&&m.guidance==='SEMI_ACTIVE_RADAR'&&m.channel&&m.target===lock.id);output.push({key:'battery-control',x:0,y:0,z:0,angle:heading({x:0,y:0},p),beam:cfg.fireControlBeam,band:cfg.emissionBand,waveform:illuminating?'ILLUMINATION':'FIRE_CONTROL',family:illuminating?'BETA_ILLUMINATION':'BETA_FIRE_CONTROL',strength:cfg.fireControlStrength});}}
    for(const m of s.missiles)if(m.alive&&m.guidance==='ACTIVE_RADAR'&&m.state!=='MIDCOURSE')output.push({key:'seeker-'+m.id,x:m.x,y:m.y,z:m.z,angle:m.angle,beam:s.cfg.seekerFov,band:cfg.emissionBand,waveform:'ACTIVE_SEEKER',family:'BETA_SEEKER',strength:cfg.seekerStrength});
    return output;
  }
  sense(time,dt){const emissions=this.emissions();for(const a of this.sim.aircraft){if(!a.alive)continue;receiveEmissions(a,emissions,time,this.lineOfSight);observeMissiles(a,this.sim.missiles,time,dt,this.lineOfSight);}}
  tick(dt){
    const s=this.sim,time=s.time;
    if(time>=this.nextSensor){this.sense(time,this.cfg.sensorInterval);this.nextSensor=time+this.cfg.sensorInterval;}
    for(const a of s.aircraft){
      if(!a.alive)continue;
      if(time>=a.ai.nextDecision){decideAircraft(a,time,this.trace);a.ai.nextDecision=time+this.cfg.decisionInterval;deployCountermeasures(a,time,this.decoys,this.trace);}
      flyAircraft(a,time,dt);
      if(!a.alive){s.removeContact(a.id);continue;}
      if(a.ai.state==='ATTACK RUN'&&a.preset==='WP-1'&&a.ordnance>0&&time>=a.bombReady){const solution=releaseSolution(a);if(solution?.valid){const number=Math.min(a.cfg.bombSalvo,a.ordnance);for(let n=0;n<number;n++)this.bombs.push({id:'B'+(++this.bombSerial),owner:a.id,definition:this.cfg.bombDefinition,x:a.x,y:a.y,z:a.z,vx:Math.cos(a.angle)*a.speed,vy:Math.sin(a.angle)*a.speed,vz:a.verticalSpeed,alive:true,explosive:this.cfg.bombExplosive});a.ordnance-=number;a.bombReady=time+a.cfg.bombReleaseCooldown;const contact=s.contacts.get(a.id);if(contact?.tracked)s.addLog(a.id+' observed weapon release');}}
    }
    for(const b of this.bombs){if(!b.alive)continue;b.x+=b.vx*dt;b.y+=b.vy*dt;b.vz-=this.cfg.bombGravity*dt;b.z+=b.vz*dt;if(b.z<=this.cfg.terrainHeight){b.alive=false;const miss=Math.hypot(b.x,b.y);s.effects.push({x:b.x,y:b.y,born:time,kill:false});if(miss<=this.cfg.bombHitRadius){s.hits=Math.min(s.cfg.maxPlayerHits,s.hits+this.cfg.bombDamageHits);s.addLog('Bomb impact • battery hit '+s.hits+'/'+s.cfg.maxPlayerHits);if(s.hits>=s.cfg.maxPlayerHits){s.ended=true;s.addLog('Battery lost • exercise ended');}}else if(miss<8)s.addLog('Bomb impact missed battery');}}
    this.bombs=this.bombs.filter(b=>b.alive);this.decoys=this.decoys.filter(d=>time<d.expires);
  }
  evaluateDecoys(m){
    if(!m.alive||!['SEARCHING','SEEKER LOCK'].includes(m.state)||this.sim.time<(m.nextDecoyCheck||0))return null;
    m.nextDecoyCheck=this.sim.time+this.cfg.decoyUpdate;
    const range=m.guidance==='IR'?this.sim.cfg.irSeekerRange:this.sim.cfg.seekerRange;
    const fov=rad((m.guidance==='IR'?this.sim.cfg.irFov:this.sim.cfg.seekerFov)/2);
    const current=this.sim.aircraft.find(a=>a.id===m.acquired);
    for(const d of this.decoys){if(distance(m,d)>range||Math.abs(angleDelta(heading(m,d),m.angle))>fov)continue;if(current&&d.owner!==current.id)continue;
      const geometry=1-distance(m,d)/range;const chance=(1-this.cfg.decoyResistance)*(.25+.75*geometry)*(m.state==='SEEKER LOCK'?.7:1);
      if(this.sim.random()<chance){m.decoy=d.id;m.decoyDwell=0;return d;}}
    return null;
  }
}

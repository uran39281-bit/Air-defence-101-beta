import {AIRCRAFT,RWR_PROFILES,AI_DEFAULTS,MISSION_TACTICS} from './aircraft-config.js';

export const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const rad=v=>v*Math.PI/180;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
const heading=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
const bearing=angle=>(angle*180/Math.PI+90+360)%360;
export function seeded(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

const MISSILE_STANDOFF={KH31PD:110,KH38MT:50,KH29TD:25};
function planRoute(position,mission,preset,cfg,rng){
  if(!cfg.routeVariation)return;
  // Adjacent small seeds share the first LCG bucket; warm the stream before
  // sampling a tactic so newly numbered spawns still choose different plans.
  rng();rng();
  const choices=Object.entries(MISSION_TACTICS).filter(([,p])=>p.preset===preset);
  const selected=cfg.missionProfile?choices.find(([name])=>name===cfg.missionProfile):choices[Math.floor(rng()*choices.length)];
  if(!selected)throw Error('Unsupported mission profile '+cfg.missionProfile);
  const [name,tactic]=selected,side=rng()<.5?-1:1;
  const originAngle=heading(mission.objective,position),offset=rad(tactic.offsetMin+rng()*(tactic.offsetMax-tactic.offsetMin))*side;
  const approachAngle=originAngle+offset,radius=Math.hypot(position.x-mission.objective.x,position.y-mission.objective.y);
  const altitude=clamp(tactic.altitude??position.z,cfg.safeAltitude,cfg.ceiling);
  const point=(angle,range,z=altitude)=>({x:mission.objective.x+Math.cos(angle)*range,y:mission.objective.y+Math.sin(angle)*range,z});
  mission.profile=name;mission.side=side;mission.approachAngle=approachAngle;mission.approachAltitude=altitude;
  mission.cruise=tactic.cruise;mission.routeIndex=0;mission.routeOrigin={...position};
  mission.salvoLimit=cfg.missileSalvoLimit??tactic.salvo??1;
  if(preset==='WP-0'){
    const crossing=point(originAngle+Math.PI+offset,Math.min(radius*.5,100),position.z);
    mission.intrusion=crossing;mission.route=[point(originAngle+offset*.5,radius*.65,position.z)];
  }else if(preset==='WP-3'){
    const standoff=cfg.standoffRange??MISSILE_STANDOFF[cfg.missileWeaponID]??50;
    mission.standoffRange=standoff;mission.attackPoint=point(approachAngle,standoff);
    // A far ingress leg creates distinct approach bearings. Near spawns skip it
    // so their finite turn radius cannot trap them behind an obsolete waypoint.
    mission.route=radius>standoff+45?[point(originAngle+offset*.5,Math.max(standoff+25,radius*.68))]:[];
  }else{
    const gate=Math.min(45,Math.max(cfg.attackEntry+12,radius*.45));
    mission.route=radius>gate+20?[point(originAngle+offset*.5,radius*.68),point(approachAngle,gate)]:[];
    mission.attackPoint=point(approachAngle,gate);
  }
  // Leave on a seeded side after attacking instead of crossing the battery.
  mission.exit=point(approachAngle+side*rad(55),cfg.exitRadius,Math.min(10,cfg.ceiling));
}

export function createAircraft(type,id,position,settings={},seed=1){
  const profile=AIRCRAFT[type];
  if(!profile)throw Error('Unsupported aircraft '+type);
  const cfg={...AI_DEFAULTS,...settings};
  const rng=seeded(seed);
  const exitAngle=heading({x:0,y:0},position)+Math.PI;
  const preset=settings.preset||profile.presets[0];
  const missileWeaponID=settings.missileWeaponID||profile.missileWeaponID||null;
  const mission={objective:{x:0,y:0,z:0},exit:{x:Math.cos(exitAngle)*cfg.exitRadius,y:Math.sin(exitAngle)*cfg.exitRadius,z:10},intrusion:{x:-position.x*.5,y:-position.y*.5,z:position.z},task:preset==='WP-0'?'INTRUSION / DIVERSION':preset==='WP-3'?'STANDOFF MISSILE STRIKE':'BOMB STRIKE',startedAt:null,...settings.mission};
  planRoute(position,mission,preset,{...cfg,missileWeaponID,ceiling:profile.ceiling/1000},rng);
  // Explicit assigned waypoints win over generated defaults.
  Object.assign(mission,settings.mission);
  if(preset==='WP-3'&&!mission.attackPoint){
    mission.standoffRange=cfg.standoffRange??MISSILE_STANDOFF[missileWeaponID]??50;
    const approach=heading(mission.objective,position);
    mission.attackPoint={x:mission.objective.x+Math.cos(approach)*mission.standoffRange,y:mission.objective.y+Math.sin(approach)*mission.standoffRange,z:Math.min(6,profile.ceiling/1000)};
    mission.approachAngle=approach;mission.approachAltitude=mission.attackPoint.z;
  }
  for(const point of ['objective','exit','intrusion']){if(!Number.isFinite(mission[point]?.x)||!Number.isFinite(mission[point]?.y)||!Number.isFinite(mission[point]?.z))throw Error('Invalid mission '+point+' waypoint');if(point!=='objective'&&(mission[point].z<cfg.safeAltitude||mission[point].z>profile.ceiling/1000))throw Error('Unreachable mission '+point+' altitude');}
  for(const point of [...(mission.route||[]),...(mission.attackPoint?[mission.attackPoint]:[])])if(!['x','y','z'].every(k=>Number.isFinite(point?.[k]))||point.z<cfg.safeAltitude||point.z>profile.ceiling/1000)throw Error('Invalid or unreachable mission route waypoint');
  const insideStandoff=preset==='WP-3'&&Math.hypot(position.x-mission.objective.x,position.y-mission.objective.y)<=mission.standoffRange;
  const initialGoal=mission.route?.[0]||(insideStandoff?mission.objective:mission.attackPoint)||(preset==='WP-0'?mission.intrusion:mission.objective);
  const a={id,type,profile,allegiance:'HOSTILE',...position,angle:heading(position,initialGoal),
    speed:0,health:100,controlAuthority:settings.controlAuthority??1,alive:true,retreat:false,exited:false,actualG:1,maxCommandedG:profile.commandedG,
    verticalSpeed:0,releaseStableFor:0,heat:1,signature:profile.signature,stealth:profile.stealth,
    preset,ordnance:preset==='WP-1'?profile.bombs:0,cm:profile.countermeasures,cmReady:0,bombReady:0,
    missilesRemaining:preset==='WP-3'?(settings.missilesRemaining??profile.missiles??0):0,missileWeaponID,
    missileReady:0,missileStableFor:0,missileAttackAuthorized:false,missilesFired:0,
    missileSalvoLimit:mission.salvoLimit??cfg.missileSalvoLimit??1,
    rwr:{...RWR_PROFILES[profile.rwr],...settings.rwr},maws:cfg.maws,mission,rng,
    perception:{warnings:new Map(),pending:new Map(),observed:new Map(),visualDwell:new Map(),emitterAliases:new Map(),visualAliases:new Map(),nextEmitter:0,nextVisual:0,nextEpisode:0},
    ai:{state:'MISSION APPROACH',stateSince:0,nextDecision:0,pending:null,clearSince:null,
      failedRuns:0,wasAttacking:false,primary:null,maneuver:null,riskSince:null,reactions:new Map(),dangerousApproaches:[],confidence:cfg.confidence,perceivedRisk:0},cfg};
  if(!profile.presets.includes(a.preset))throw Error('Unsupported weapon preset '+a.preset+' for '+type);
  a.speed=aircraftSpeedCap(a)*(mission.cruise??cfg.initialCruise);
  return a;
}

export function aircraftSpeedCap(a){
  const p=a.profile,altitude=Math.min(a.z*1000,p.referenceAltitude);
  const base=(p.lowSpeed+(p.maxSpeed-p.lowSpeed)*clamp(altitude/p.referenceAltitude,0,1))/3600;
  const healthFactor=.5+.5*clamp(a.health/100,0,1);
  const loadRatio=a.preset==='WP-3'?(a.profile.missiles?a.missilesRemaining/a.profile.missiles:0):(a.profile.bombs?a.ordnance/a.profile.bombs:0);
  const loadFactor=1-.08*clamp(loadRatio,0,1);
  return base*healthFactor*loadFactor;
}

export function achievableG(a){
  const cap=aircraftSpeedCap(a),energy=clamp(a.speed/Math.max(cap,.01),.15,1);
  return Math.min(a.profile.structuralG,a.profile.commandedG,
    1+(a.profile.commandedG-1)*Math.min(1,energy*energy*1.35)*(.4+.6*clamp(a.health/100,0,1))*clamp(a.controlAuthority,0,1));
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
  if(e.waveform==='ACTIVE_SEEKER'&&p.seeker)return {class:'MISSILE SEEKER',confidence:.85,priority:3,guidance:'ACTIVE_RADAR'};
  if(e.waveform==='ILLUMINATION'&&p.illumination)return {class:'ILLUMINATION',confidence:.8,priority:3,guidance:'SEMI_ACTIVE_RADAR'};
  if((e.waveform==='FIRE_CONTROL'||e.waveform==='ILLUMINATION')&&p.fireControl)return {class:'FIRE CONTROL',confidence:.75,priority:2};
  if((e.waveform==='SEARCH'||e.waveform==='PULSE_DOPPLER')&&p.search)return {class:'SEARCH',confidence:.7,priority:1};
  return {class:'UNKNOWN EMITTER',confidence:.4,priority:1};
}

export function receiveEmissions(a,emissions,time,lineOfSight){
  const sense=a.perception,p=a.rwr;
  for(const [id,w]of sense.warnings)if(time>w.expires)sense.warnings.delete(id);
  for(const e of emissions){
    if(!canReceive(a,e,time,lineOfSight)||a.rng()<p.missChance)continue;
    let alias=sense.emitterAliases.get(e.key);
    if(!alias){alias='RX-'+(++sense.nextEmitter);sense.emitterAliases.set(e.key,alias);}
    const reading=classify(p,e,a.rng);
    let b=bearing(heading(a,e));
    b=p.sectors?((Math.round(b/(360/p.sectors))*(360/p.sectors))%360):((b+(a.rng()*2-1)*p.bearingError+360)%360);
    const received={id:alias,...reading,bearing:b,time,source:'RWR'};
    const current=sense.warnings.get(alias);
    if(current&&current.class===reading.class){sense.warnings.set(alias,{...received,episode:current.episode,expires:time+p.memory});continue;}
    const pending=sense.pending.get(alias);
    if(!pending||pending.class!==reading.class)sense.pending.set(alias,{...received,episode:current?.episode??++sense.nextEpisode,ready:time+p.delay,lastReceived:time});
    else Object.assign(pending,{lastReceived:time,bearing:b,confidence:reading.confidence});
  }
  for(const [id,w]of sense.pending){
    if(time>=w.ready){sense.warnings.set(id,{id:w.id,class:w.class,confidence:w.confidence,priority:w.priority,bearing:w.bearing,time:w.lastReceived,guidance:w.guidance||'UNKNOWN',episode:w.episode,source:'RWR',expires:w.lastReceived+p.memory});sense.pending.delete(id);}
  }
  for(const [id,w]of sense.warnings)if(time>w.expires)sense.warnings.delete(id);
  if(sense.warnings.size>p.capacity){const sorted=[...sense.warnings.values()].sort((a,b)=>b.priority-a.priority||b.time-a.time);sense.warnings=new Map(sorted.slice(0,p.capacity).map(w=>[w.id,w]));}
}

export function observeMissiles(a,missiles,time,dt,lineOfSight=()=>true){
  const cfg=a.cfg,sense=a.perception;
  for(const [id,o]of sense.observed)if(time>o.expires)sense.observed.delete(id);
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
    const history=[...(previous?.rangeHistory||[]),{time,range:measuredRange}].filter(p=>time-p.time<=cfg.ttiObservationWindow+1);
    let closing=null,tti=null;
    // Range remains noisy. Infer urgency only from sustained observations,
    // never from the missile's hidden velocity, target or true time to impact.
    if(history.length>=4&&time-history[0].time>=cfg.ttiObservationWindow){
      const first=history.slice(0,2),last=history.slice(-2),mean=xs=>xs.reduce((n,p)=>n+p.range,0)/xs.length;
      const span=(last[0].time+last[1].time-first[0].time-first[1].time)/2;
      const change=mean(first)-mean(last),margin=Math.max(...history.map(p=>p.range))*.2;
      if(span>0&&change>margin){closing=change/span;tti=clamp(measuredRange/closing,0,120);}
    }
    sense.observed.set(alias,{id:alias,class:'OBSERVED MISSILE',source:maws?'MAWS':'VISUAL',priority:4,confidence:.8,bearing:b,rangeEstimate:measuredRange,rangeHistory:history,closingEstimate:closing,timeToImpactEstimate:tti,time,episode:previous?.episode??++sense.nextEpisode,expires:time+cfg.missileMemory,guidance:'UNKNOWN'});
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
  const enteringDefense=state==='DEFENSIVE'||state==='MISSILE EVASION';
  if(enteringDefense&&['MISSION APPROACH','CAUTIOUS','ATTACK RUN','LAUNCH WINDOW'].includes(a.ai.state)){
    if(['ATTACK RUN','LAUNCH WINDOW'].includes(a.ai.state))a.ai.failedRuns++;
    a.ai.dangerousApproaches.push({time,bearing:a.ai.primary?.bearing??null,routeAngle:a.mission.approachAngle??heading(a.mission.objective,a),confidence:a.ai.primary?.confidence??.4});
    a.ai.dangerousApproaches=a.ai.dangerousApproaches.slice(-8);a.mission.windowStartedAt=null;
  }
  a.ai.state=state;a.ai.stateSince=time;
  if(state==='DISENGAGE'){a.retreat=true;}
  trace(a,time,entries,'STATE',{reason});return true;
}

function replanRememberedApproach(a,time,entries){
  const memory=a.ai.dangerousApproaches.at(-1);
  if(!memory||a.preset==='WP-0'||a.retreat)return;
  // Only the assigned objective, own route and a received warning are used.
  // A warning gives a noisy direction; it never grants emitter coordinates.
  const prior=a.mission.approachAngle??memory.routeAngle;
  const warningAngle=Number.isFinite(memory.bearing)?rad(memory.bearing-90):null;
  const side=warningAngle===null?-(a.mission.side||1):angleDelta(warningAngle,a.angle)>0?-1:1;
  const angle=prior+side*rad(a.cfg.missileRepositionDegrees+a.rng()*10);
  const range=a.preset==='WP-3'?a.mission.standoffRange:Math.max(35,a.cfg.attackEntry+16);
  const point={x:a.mission.objective.x+Math.cos(angle)*range,y:a.mission.objective.y+Math.sin(angle)*range,z:a.mission.approachAltitude??a.cfg.bombAltitude};
  a.mission.side=side;a.mission.approachAngle=angle;a.mission.route=[];a.mission.routeIndex=0;
  a.mission.reapproach=point;a.mission.attackPoint={...point};a.mission.windowStartedAt=null;
  trace(a,time,entries,'REPLAN',{reason:'remembered warning sector',confidence:memory.confidence});
}

function defensiveManeuver(a,threats,time){
  const primary=threats[0],side=a.rng()<.5?-1:1;
  // Bearing-only policy. For multiple threats, choose a circular mean heading
  // away from their weighted bearings; there is no access to true ranges.
  const incoming=threats.filter(t=>t.priority>=2);
  const knownBearing=Number.isFinite(primary.bearing);
  let away=knownBearing?(primary.bearing-90)*Math.PI/180+Math.PI:a.angle+side*rad(45+45*a.rng());
  if(incoming.length>1&&incoming.every(t=>Number.isFinite(t.bearing))){let x=0,y=0;for(const t of incoming){const b=(t.bearing-90)*Math.PI/180;x+=Math.cos(b)*t.priority;y+=Math.sin(b)*t.priority;}if(Math.hypot(x,y)>.05)away=Math.atan2(y,x)+Math.PI;}
  const beam=knownBearing?(primary.bearing-90)*Math.PI/180+side*Math.PI/2:away;
  const useBeam=knownBearing&&a.cfg.notchSupported&&a.rng()<a.cfg.skill*.45&&primary.class==='FIRE CONTROL';
  a.ai.maneuver={kind:useBeam?'BEAM ATTEMPT':'SEPARATION TURN',angle:useBeam?beam:away+side*rad((1-a.cfg.skill)*20),altitude:Math.max(a.cfg.safeAltitude,a.z-(a.profile.maneuver>3?.8:.2)),heldUntil:time+Math.max(4,a.cfg.stateHold),side};
}

export function decideAircraft(a,time,entries=null){
  if(!a.alive||a.exited)return;
  const ai=a.ai,cfg=a.cfg,threats=perceivedThreats(a),primary=threats[0]||null;
  a.missileAttackAuthorized=false;
  if(a.mission.startedAt===null)a.mission.startedAt=time;
  ai.primary=primary;
  ai.dangerousApproaches=ai.dangerousApproaches.filter(p=>time-p.time<=cfg.routeMemory);
  const energy=clamp(a.speed/Math.max(aircraftSpeedCap(a),.01),0,1);
  ai.confidence=clamp(cfg.confidence*(a.health/100)*(.5+.5*energy),0,1);
  ai.perceivedRisk=clamp((primary?primary.priority/4*primary.confidence:0)+ai.failedRuns*.1+ai.dangerousApproaches.length*.05,0,1);
  const episodeKey=t=>t.id+':'+(t.episode??'current')+':'+t.priority;
  const activeKeys=new Set(threats.map(episodeKey));
  for(const key of ai.reactions.keys())if(!activeKeys.has(key))ai.reactions.delete(key);
  if(ai.pending&&!activeKeys.has(ai.pending.key))ai.pending=null;
  const exhausted=a.preset==='WP-1'?a.ordnance<=0:a.preset==='WP-3'?a.missilesRemaining<=0:false;
  if(a.health<cfg.abortHealth||a.controlAuthority<.25||ai.failedRuns>=cfg.failedApproaches||exhausted||time-a.mission.startedAt>=cfg.missionMaxSeconds){transition(a,'DISENGAGE',time,entries,'condition, weapons, failed approaches, or mission time limit');}
  if(a.z<=cfg.safeAltitude+.01){ai.maneuver={kind:'TERRAIN AVOIDANCE',angle:a.angle,altitude:cfg.safeAltitude+.5,heldUntil:time+2};trace(a,time,entries,'TERRAIN');return;}
  const backgroundRecovery=primary?.priority<2&&['DEFENSIVE','MISSILE EVASION','REASSESS'].includes(ai.state);
  if(backgroundRecovery){
    ai.clearSince??=time;
    if(ai.state!=='REASSESS'&&time-ai.clearSince>=cfg.safeClear&&time-ai.stateSince>=cfg.stateHold){transition(a,'REASSESS',time,entries,'acute warning cleared; search remains');ai.maneuver=null;}
    else if(ai.state==='REASSESS'&&time-ai.stateSince>=cfg.stateHold){replanRememberedApproach(a,time,entries);transition(a,'MISSION APPROACH',time,entries,'retry eligible despite background search');ai.maneuver=null;}
  }
  if(primary){
    if(!backgroundRecovery)ai.clearSince=null;
    if(ai.riskSince===null)ai.riskSince=time;
    const urgency=primary.priority;
    const key=episodeKey(primary);
    let pending=ai.reactions.get(key);
    if(!pending){
      const emergency=urgency>=3;
      const delay=emergency?cfg.emergencyMin+a.rng()*(cfg.emergencyMax-cfg.emergencyMin):cfg.reactionMin+a.rng()*(cfg.reactionMax-cfg.reactionMin);
      pending={id:primary.id,key,priority:urgency,ready:time+delay,acted:false};
      ai.reactions.set(key,pending);ai.pending=pending;
      trace(a,time,entries,'EVIDENCE',{evidence:threats.map(t=>({id:t.id,class:t.class,source:t.source,confidence:t.confidence}))});
    }
    ai.pending=pending;
    if(time>=ai.pending.ready){
      const oldPriority=ai.state==='MISSILE EVASION'?3:ai.state==='DEFENSIVE'?2:ai.state==='CAUTIOUS'?1:0;
      const mayChange=time-ai.stateSince>=cfg.stateHold||urgency>oldPriority;
      const state=urgency>=3?'MISSILE EVASION':urgency===2?'DEFENSIVE':'CAUTIOUS';
      const recovering=urgency<2&&['DEFENSIVE','MISSILE EVASION','REASSESS'].includes(ai.state);
      if(ai.state!=='DISENGAGE'&&mayChange&&!recovering){
        // High aggression can finish a briefly available release solution,
        // never grant immunity or ignore damage/flight constraints.
        const finishing=ai.state==='LAUNCH WINDOW'&&urgency===1||ai.state==='ATTACK RUN'&&(urgency===1||urgency===2&&cfg.aggression>.7&&a.health>75&&energy>.55&&releaseSolution(a)?.valid&&ai.perceivedRisk<=(cfg.riskTolerance+ai.confidence)/2);
        if(!finishing)transition(a,state,time,entries,'perceived '+primary.class);
      }
      if(urgency>=2&&ai.state!=='ATTACK RUN'&&(ai.state!=='CAUTIOUS')&&(!ai.maneuver||time>=ai.maneuver.heldUntil))defensiveManeuver(a,threats,time);
      if(urgency===1&&!ai.maneuver){const side=a.rng()<.5?-1:1;ai.maneuver={kind:'CAUTIOUS OFFSET',side,angle:a.angle+side*rad(7),altitude:a.z,heldUntil:time+6};}
      ai.pending.acted=true;
    }
    if(primary.priority>=2&&time-ai.riskSince>cfg.riskAbortSeconds&&(cfg.aggression<.4||a.cm===0))transition(a,'DISENGAGE',time,entries,'accumulated mission risk');
  }else{
    ai.riskSince=null;
    if(ai.clearSince===null)ai.clearSince=time;
    if(ai.state!=='DISENGAGE'&&['CAUTIOUS','DEFENSIVE','MISSILE EVASION'].includes(ai.state)&&time-ai.clearSince>=cfg.safeClear&&time-ai.stateSince>=cfg.stateHold){transition(a,'REASSESS',time,entries,'warnings and observed missile memory cleared');ai.pending=null;ai.maneuver=null;}
    else if(ai.state==='REASSESS'&&time-ai.stateSince>=cfg.stateHold){replanRememberedApproach(a,time,entries);transition(a,'MISSION APPROACH',time,entries,'retry eligible');ai.maneuver=null;}
    if(ai.state==='MISSION APPROACH'&&a.preset==='WP-1'&&!a.mission.reapproach&&energy>=cfg.attackEnergyMinimum&&distance(a,a.mission.objective)<=cfg.attackEntry)transition(a,'ATTACK RUN',time,entries,'mission approach complete');
  }
  if(!a.retreat&&['MISSION APPROACH','CAUTIOUS'].includes(ai.state)&&a.preset==='WP-1'&&!a.mission.reapproach&&energy>=cfg.attackEnergyMinimum&&distance(a,a.mission.objective)<=cfg.attackEntry&&(!primary||primary.priority<2))transition(a,'ATTACK RUN',time,entries,'release approach despite manageable search evidence');
  if(ai.state==='ATTACK RUN'&&distance(a,a.mission.objective)>8&&Math.abs(angleDelta(heading(a,a.mission.objective),a.angle))>rad(110)){
    ai.failedRuns++;const side=ai.dangerousApproaches.length?(ai.dangerousApproaches.at(-1).bearing-bearing(a.angle)>0?-1:1):1;const retryAngle=a.angle+side*rad(12);a.mission.reapproach={x:a.x+Math.cos(retryAngle)*25,y:a.y+Math.sin(retryAngle)*25,z:cfg.bombAltitude};transition(a,ai.failedRuns>=cfg.failedApproaches?'DISENGAGE':'REASSESS',time,entries,'missed release approach');
  }
  if(a.preset==='WP-3'&&!a.retreat){
    const mission=a.mission,routeComplete=(mission.routeIndex||0)>=(mission.route?.length||0);
    const allowedState=['MISSION APPROACH','CAUTIOUS','LAUNCH WINDOW'].includes(ai.state);
    const actionable=primary&&primary.priority>=2&&ai.pending?.acted;
    const radius=Math.hypot(a.x-mission.objective.x,a.y-mission.objective.y);
    const nearWindow=distance(a,mission.attackPoint)<=cfg.routeWaypointRadius+a.speed*cfg.routeLookaheadSeconds||radius<=mission.standoffRange*1.08;
    if(allowedState&&!actionable&&!mission.reapproach&&routeComplete&&nearWindow&&energy>=cfg.missileLaunchEnergy){
      transition(a,'LAUNCH WINDOW',time,entries,'standoff launch position reached');
      mission.windowStartedAt??=time;
      a.missileAttackAuthorized=true;
      const tooClose=radius<(mission.weaponEnvelope?.minRange??3)+4;
      if(tooClose||time-mission.windowStartedAt>cfg.missileWindowSeconds){
        a.missileAttackAuthorized=false;ai.failedRuns++;mission.windowStartedAt=null;
        const angle=heading(mission.objective,a)+(mission.side||1)*rad(cfg.missileRepositionDegrees);
        mission.reapproach={x:mission.objective.x+Math.cos(angle)*mission.standoffRange,y:mission.objective.y+Math.sin(angle)*mission.standoffRange,z:mission.approachAltitude};
        transition(a,ai.failedRuns>=cfg.failedApproaches?'DISENGAGE':'REASSESS',time,entries,'launch window unavailable; reposition or abort');
      }
    }
  }
  trace(a,time,entries,'DECISION');
}

export function deployCountermeasures(a,time,decoys,entries=null){
  const threat=a.ai.primary,cfg=a.cfg;
  if(!threat||threat.priority<3||time<a.cmReady||a.cm<=0||time<(a.ai.pending?.ready??Infinity))return false;
  const reaction=a.ai.pending;if((reaction.bursts||0)>=cfg.cmMaxBurstsPerEpisode)return false;
  const reserve=Math.ceil(a.profile.countermeasures*cfg.cmReserve),emergency=threat.priority>=4||threat.class==='MISSILE SEEKER';
  if(!emergency&&a.cm-cfg.cmBurst<reserve)return false;
  const count=Math.min(cfg.cmBurst,a.cm);reaction.bursts=(reaction.bursts||0)+1;a.cm-=count;a.cmReady=time+cfg.cmCooldown;
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
  const envelope=h>=cfg.bombMinAltitude&&h<=cfg.bombMaxAltitude&&a.speed>=cfg.bombMinSpeed&&a.speed<=cfg.bombMaxGameplaySpeed;
  const stable=a.actualG<=cfg.bombStableMaxG&&Math.abs(a.verticalSpeed)<=cfg.bombStableClimb&&a.releaseStableFor>=cfg.bombStableDwell;
  return {flightTime,point,error,envelope,stable,valid:envelope&&stable&&error<=cfg.bombReleaseRadius&&headingError<=rad(cfg.bombHeadingTolerance)};
}

export function flyAircraft(a,time,dt){
  if(!Number.isFinite(dt)||dt<=0)return;
  const cfg=a.cfg,ai=a.ai;
  const mission=a.mission,waypointRadius=cfg.routeWaypointRadius+a.speed*cfg.routeLookaheadSeconds;
  if(!a.retreat&&!mission.reapproach&&ai.state!=='ATTACK RUN'){
    const route=mission.route||[];
    while((mission.routeIndex||0)<route.length){
      const index=mission.routeIndex||0,point=route[index],previous=index?route[index-1]:mission.routeOrigin||point;
      const legX=point.x-previous.x,legY=point.y-previous.y;
      const passed=(a.x-point.x)*legX+(a.y-point.y)*legY>0;
      if(Math.hypot(a.x-point.x,a.y-point.y)>waypointRadius&&!passed)break;
      mission.routeIndex=index+1;
    }
  }
  const nextGoal=()=>ai.state==='ATTACK RUN'||a.preset==='WP-3'&&ai.state==='LAUNCH WINDOW'?mission.objective:mission.route?.[mission.routeIndex||0]||(a.preset==='WP-0'?mission.intrusion:a.preset==='WP-3'?mission.attackPoint:mission.objective);
  let goal=a.retreat?mission.exit:mission.reapproach||nextGoal();
  if(!a.retreat&&mission.reapproach&&distance(a,goal)<waypointRadius){mission.reapproach=null;transition(a,'MISSION APPROACH',time,null,'reapproach waypoint reached');goal=nextGoal();}
  if(a.preset==='WP-0'&&!a.retreat&&distance(a,goal)<cfg.intrusionWaypointRadius){transition(a,'DISENGAGE',time,null,'intrusion route complete');goal=a.mission.exit;}
  let desired=heading(a,goal),altitude=a.retreat?Math.min(a.profile.ceiling/1000,mission.exit.z):a.preset==='WP-0'?goal.z:mission.approachAltitude??cfg.bombAltitude;
  if(ai.maneuver?.kind==='TERRAIN AVOIDANCE'&&time<ai.maneuver.heldUntil){desired=ai.maneuver.angle;altitude=ai.maneuver.altitude;}
  else if(ai.maneuver&&(['DEFENSIVE','MISSILE EVASION'].includes(ai.state)||ai.state==='DISENGAGE'&&ai.primary?.priority>=2)){desired=ai.maneuver.angle;altitude=ai.maneuver.altitude;}
  else if(ai.state==='CAUTIOUS'&&ai.maneuver&&time<ai.maneuver.heldUntil)desired+=ai.maneuver.side?ai.maneuver.side*rad(7):rad(7);
  const speedCap=aircraftSpeedCap(a),defending=['DEFENSIVE','MISSILE EVASION','DISENGAGE'].includes(ai.state);
  const cap=speedCap*(defending?1:mission.cruise??1),g=achievableG(a),v=Math.max(a.speed,cfg.minimumSpeed);
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
  const stablePath=a.actualG<=cfg.bombStableMaxG&&Math.abs(a.verticalSpeed)<=cfg.bombStableClimb&&Math.abs(angleDelta(heading(a,a.mission.objective),a.angle))<=rad(cfg.bombHeadingTolerance);
  a.releaseStableFor=stablePath?a.releaseStableFor+dt:0;
  a.x+=Math.cos(a.angle)*a.speed*dt;a.y+=Math.sin(a.angle)*a.speed*dt;
  if(a.retreat&&(distance(a,a.mission.exit)<=cfg.exitWaypointRadius||Math.hypot(a.x,a.y)>cfg.exitRadius)){a.exited=true;a.alive=false;ai.state='EXITED';}
}

export class AircraftSystems {
  constructor(sim,settings={}){this.sim=sim;this.cfg={...AI_DEFAULTS,...settings};this.nextSensor=0;this.trace=settings.trace?[]:null;this.decoys=[];this.bombs=[];this.bombSerial=0;this.lineOfSight=settings.lineOfSight||(()=>true);}
  create(type,id,position,settings={}){const overrides={...this.cfg,aggression:AIRCRAFT[type].aggression,...this.cfg.aircraftOverrides?.[type],...settings};return createAircraft(type,id,position,overrides,this.sim.cfg.seed+this.sim.serial*7919);}
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
      if(a.preset==='WP-3'&&s.hostileWeapons?.profile){
        const envelope=s.hostileWeapons.profile(a);
        if(envelope){
          if(Number.isFinite(envelope.standoffRange)&&envelope.standoffRange!==a.mission.standoffRange){
            a.mission.standoffRange=envelope.standoffRange;
            const approach=a.mission.approachAngle??heading(a.mission.objective,a);
            a.mission.attackPoint={x:a.mission.objective.x+Math.cos(approach)*envelope.standoffRange,y:a.mission.objective.y+Math.sin(approach)*envelope.standoffRange,z:a.mission.approachAltitude};
          }
          a.mission.weaponEnvelope=envelope;
        }
      }
      if(time>=a.ai.nextDecision){decideAircraft(a,time,this.trace);a.ai.nextDecision=time+this.cfg.decisionInterval;deployCountermeasures(a,time,this.decoys,this.trace);}
      flyAircraft(a,time,dt);
      if(!a.alive){s.removeContact(a.id);continue;}
      if(a.preset==='WP-3'&&a.missileAttackAuthorized&&s.hostileWeapons?.canLaunch(a)){
        const missile=s.hostileWeapons.launch(a);
        if(missile){
          a.missilesFired++;a.mission.lastLaunchAt=time;
          trace(a,time,this.trace,'HOSTILE LAUNCH',{weapon:a.missileWeaponID,missile:missile.id});
          if(a.missilesFired>=a.missileSalvoLimit||a.missilesRemaining<=0){a.missileAttackAuthorized=false;transition(a,'DISENGAGE',time,this.trace,'planned missile salvo complete');}
        }
      }
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

import {EQUIPMENT,BETA,sweepInterval,ICONS} from './config.js';
import {AircraftSystems,transition} from './aviation.js';
import {HostileWeapons} from './hostile-weapons.js';
const TAU=Math.PI*2, rad=d=>d*Math.PI/180;
export const rangeOf=p=>Math.hypot(p.x,p.y);
export const bearingOf=p=>(Math.atan2(p.x,-p.y)*180/Math.PI+360)%360;
const diff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const falloff=(r,e,o)=>r<=e?1:clamp(1-(r-e)/(e*(o-1)),0,1);
function toward(p,t){return Math.atan2(t.y-p.y,t.x-p.x);}
function fov(m,t,degrees){return Math.abs(diff(toward(m,t),m.angle))<=rad(degrees/2);}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));}
function pointSegment(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy+(p.z-a.z)*dz)/(dx*dx+dy*dy+dz*dz||1),0,1);return distance(p,{x:a.x+dx*t,y:a.y+dy*t,z:a.z+dz*t});}
export class Simulation {
 constructor(options={}){this.cfg={...BETA,...options};this.equipment={...EQUIPMENT,...options.equipment,missile:{...EQUIPMENT.missile,...options.missile}};this.time=0;this.phase=0;this.radar=true;this.irst=false;this.auto=true;this.switches={};this.contacts=new Map();this.irTracks=new Map();this.aircraft=[];this.missiles=[];this.hostileMissiles=[];this.effects=[];this.log=[];this.selected=null;this.launcher=0;this.locked=null;this.lockAttempt=null;this.lockLostFor=0;this.serial=0;this.missileSerial=0;this.seed=this.cfg.seed;this.channels=new Map();this.launchers=Array.from({length:4},()=>({loaded:this.cfg.roundsPerLauncher,reload:0,cooldown:0}));this.reserve=this.cfg.reserveRounds;this.hits=0;this.kills=0;this.intercepts=0;this.fired=0;this.ended=false;this.nextSpawn=this.cfg.spawnInterval;this.lastIr=0;this.aviation=new AircraftSystems(this,options.aviation||{});this.hostileWeapons=new HostileWeapons(this,options.hostileWeapons||{});this.addLog('Horizon Shield online • beta exercise');this.addLog('Scan rating '+this.cfg.scanRating.toFixed(2)+' • provisional defaults');for(let i=0;i<this.cfg.startAircraft;i++)this.spawn(i);}
 random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 addLog(message){this.log.push({time:this.time,message});if(this.log.length>250)this.log.shift();}
 spawn(index=this.serial,settings={}){
  const types=this.equipment.nctr,type=types[index%types.length],group=Math.floor(index/types.length);
  const missileMission=this.cfg.hostileMissilesEnabled&&type!=='MiG-25'&&((type==='Su-27'&&group%2===0)||(type==='MiG-29'&&group%3!==0)||(type==='Tu-160'&&group%2===1));
  const preset=type==='MiG-25'?'WP-0':missileMission?'WP-3':'WP-1';
  const radius=index===0&&missileMission?145:[178,228,282,340,390,270][index%6],angle=rad((index*63+24)%360);
  const a=this.aviation.create(type,'C'+String(++this.serial).padStart(3,'0'),{x:Math.sin(angle)*radius,y:-Math.cos(angle)*radius,z:type==='MiG-25'?18:8+this.random()*3},{preset,routeVariation:true,...(type==='MiG-29'&&group%3===2?{missileWeaponID:'KH29TD'}:{}),...settings});
  a.health=this.cfg.targetHealth;this.aircraft.push(a);return a;
 }
 interceptables(){return [...this.aircraft,...this.hostileMissiles].filter(a=>a.alive);}
 observeHostileRelease(a,m){
  // A launch report is observation, not a global event revealing hidden intent.
  // A tracked carrier plus LOS provides a simplified optical plume cue; exact
  // weapon identification is withheld. The missile still needs its own track.
  const c=this.contacts.get(a.id),ir=this.irTracks.get(a.id);
  if((this.radar&&this.usable(c)||this.irst&&ir&&this.time-ir.first>=this.cfg.irstAcquire&&this.time-ir.lastSeen<this.cfg.coastTime)&&this.aviation.lineOfSight({x:0,y:0,z:0},m,this.time))this.addLog(a.id+' possible weapon release • watch for incoming contacts');
 }
 trackCount(){return [...this.contacts.values()].filter(c=>c.tracked).length;}
 estimate(c){if(!c)return null;const dt=c.tracked?this.time-c.trackTime:0;return {x:c.trackX??c.x,y:c.trackY??c.y,z:c.altitude??0,...(c.tracked?{x:c.trackX+c.vx*dt,y:c.trackY+c.vy*dt,z:c.altitude+c.vz*dt}:{x:c.x,y:c.y})};}
 usable(c){return !!c&&c.tracked&&this.trackQuality(c)>=this.cfg.launchQuality&&this.time-c.trackTime<this.cfg.trackTimeout;}
 trackQuality(c){return c.tracked?clamp(c.quality-(this.time-c.trackTime)*this.cfg.uncertaintyPerSecond,0,1):0;}
 isStale(c){return c.tracked&&this.time-c.trackTime>this.cfg.coastTime;}
 getSelected(){return this.contacts.get(this.selected)||this.irTracks.get(this.selected)||null;}
 select(id){if(this.contacts.has(id)||this.irTracks.has(id))this.selected=id;}
 visible(){const map=new Map(this.contacts);for(const [id,c]of this.irTracks)if(!map.has(id))map.set(id,c);return [...map.values()];}
 nextTarget(){const v=this.visible();if(v.length)this.selected=v[(v.findIndex(c=>c.id===this.selected)+1)%v.length].id;}
 icon(c){if(c.allegiance==='HOSTILE')return c.kind==='MISSILE'?ICONS.hostileMissile:c.recognized?ICONS.hostile:ICONS.hostileUnknown;if(c.allegiance==='FRIENDLY')return c.recognized?ICONS.friendly:ICONS.friendlyUnknown;return c.tracked?ICONS.unknownTrack:ICONS.unknown;}
 measure(a){const r=rangeOf(a),strength=falloff(r,this.equipment.detection*(a.kind==='MISSILE'?this.cfg.missileDetectionFactor:1),this.cfg.outerRangeFactor);if(!strength||this.random()>strength*(a.kind==='MISSILE'?.94:.985))return;let c=this.contacts.get(a.id);if(!c){c={id:a.id,source:'RADAR',allegiance:'UNKNOWN',recognized:false,type:null,confidence:0,tracked:false,history:[],evidence:0,first:this.time};this.contacts.set(a.id,c);this.addLog(a.id+' detected • UNKNOWN');if(!this.selected)this.selected=a.id;}
 const error=(1-strength)*.6+.025;const measurement={x:a.x+(this.random()-.5)*error,y:a.y+(this.random()-.5)*error,z:a.z+(this.random()-.5)*.012,time:this.time};c.x=measurement.x;c.y=measurement.y;c.range=rangeOf(measurement);c.bearing=bearingOf(measurement);c.lastSeen=this.time;c.history.push(measurement);if(c.history.length>4)c.history.shift();
 // Recognition and allegiance arrive as separate modeled sensor evidence.
 if(a.kind==='MISSILE'){
  // Repeated small fast returns classify an incoming weapon. The radar never
  // exposes its exact weapon, guidance, carrier decision or hidden launch.
  c.evidence++;if(c.evidence>=this.cfg.missileClassificationSweeps&&!c.recognized){c.kind='MISSILE';c.recognized=true;c.type='MISSILE';c.allegiance='HOSTILE';c.confidence=.85;this.addLog(c.id+' INCOMING MISSILE • radar classification');}
 }else if(r<=this.cfg.idEvidenceRange){c.evidence+=sweepInterval(this.cfg.scanRating);if(c.evidence>=this.cfg.idTypeSeconds&&!c.recognized&&this.equipment.nctr.includes(a.type)){c.recognized=true;c.type=a.type;this.addLog(c.id+' NCTR match • '+c.type);}if(c.evidence>=this.cfg.idAllegianceSeconds&&c.allegiance==='UNKNOWN'){c.allegiance='HOSTILE';c.confidence=.9;this.addLog(c.id+' HOSTILE • exercise-intelligence confirmation');}}
 if(c.tracked&&this.auto)this.updateTrack(c);
 }
 updateTrack(c){const h=c.history;if(h.length<2)return;const p=h[h.length-2],n=h[h.length-1],dt=n.time-p.time;if(dt<=0)return;const quality=falloff(c.range,this.equipment.track,this.cfg.outerRangeFactor);if(quality<this.cfg.launchQuality)return;c.tracked=true;c.trackX=n.x;c.trackY=n.y;c.altitude=n.z;c.vx=(n.x-p.x)/dt;c.vy=(n.y-p.y)/dt;c.vz=(n.z-p.z)/dt;c.speed=Math.hypot(c.vx,c.vy)*3600;c.heading=(Math.atan2(c.vx,-c.vy)*180/Math.PI+360)%360;c.trackTime=n.time;c.quality=quality;}
 allocateTracks(){if(!this.radar||!this.auto)return;const eligible=[...this.contacts.values()].filter(c=>!c.tracked&&c.history.length>=2&&this.time-c.lastSeen<sweepInterval(this.cfg.scanRating)+.1&&this.time-c.first>=this.cfg.trackAcquire&&falloff(c.range,this.equipment.track,this.cfg.outerRangeFactor)>=this.cfg.launchQuality).sort((a,b)=>(b.kind==='MISSILE')-(a.kind==='MISSILE')||a.range-b.range);for(const c of eligible){if(this.trackCount()>=this.equipment.tracks){if(c.kind!=='MISSILE')continue;const displaced=[...this.contacts.values()].filter(t=>t.tracked&&t.kind!=='MISSILE'&&t.id!==this.locked&&t.id!==this.lockAttempt?.id).sort((a,b)=>b.range-a.range)[0];if(!displaced)continue;displaced.tracked=false;delete displaced.trackX;delete displaced.trackY;this.addLog(displaced.id+' TWS slot reassigned to incoming missile');}this.updateTrack(c);if(c.tracked)this.addLog(c.id+' TWS track established');}}
 toggleSensor(kind){if(this.switches[kind])return;this.switches[kind]={remaining:kind==='radar'?this.cfg.radarSwitch:this.cfg.irstSwitch,target:!this[kind]};this.addLog(kind.toUpperCase()+' switching');}
 setAuto(){this.auto=!this.auto;this.addLog('AUTO TRACK '+(this.auto?'ON':'OFF • tracks coast; midcourse updates may be lost'));}
 resetRadar(){this.contacts.clear();this.locked=null;this.lockAttempt=null;this.addLog('RESET • radar data cleared; IRST and airborne missiles retained');this.guidanceConsequences();}
 guidanceConsequences(){for(const m of this.missiles){if(!m.alive||!m.channel)continue;if(m.guidance==='ACTIVE_RADAR'&&!this.usable(this.contacts.get(m.target)))this.activateSeeker(m,'radar support lost');}}
 lock(){const c=this.contacts.get(this.selected);if(!this.radar)return this.addLog('LOCK denied • radar OFF');if(!this.usable(c))return this.addLog('LOCK denied • usable TWS track required');if(falloff(rangeOf(this.estimate(c)),this.equipment.lock,this.cfg.outerRangeFactor)<this.cfg.launchQuality)return this.addLog('LOCK denied • outside lock-quality envelope');this.lockAttempt={id:c.id,elapsed:0};this.addLog(c.id+' fire-control acquisition');}
 unlock(){if(this.locked===this.selected){this.addLog(this.locked+' UNLOCK • semi-active guidance interrupted');this.locked=null;}if(this.lockAttempt?.id===this.selected)this.lockAttempt=null;}
 supported(m){return this.channels.has(m.id);}
 releaseChannel(m){this.channels.delete(m.id);m.channel=false;}
 activateSeeker(m,reason){this.releaseChannel(m);m.state='SEARCHING';m.searchTime=0;m.acquireTime=0;m.acquired=null;this.addLog(m.id+' seeker SEARCHING • '+reason);}
 overflow(){return this.channels.size>=this.equipment.channels?[...this.channels.values()].sort((a,b)=>a.born-b.born)[0]:null;}
 fireReason(guidance=this.equipment.missile.guidance){if(this.ended)return 'Exercise complete';const l=this.launchers[this.launcher];if(l.reload>0)return 'Launcher reloading';if(!l.loaded)return 'Launcher empty';if(l.cooldown>0)return 'Launcher cooling';const c=guidance==='IR'?this.irTracks.get(this.selected):this.contacts.get(this.selected);if(guidance==='IR'){if(!this.irst||!c||this.time-c.first<this.cfg.irstAcquire)return 'Valid acquired IRST cue required';}else{if(!this.radar)return 'Radar OFF';if(!this.usable(c))return 'Usable TWS track required';if(guidance==='SEMI_ACTIVE_RADAR'&&this.locked!==c.id)return 'Continuous radar lock required';}if(rangeOf(guidance==='IR'?c:this.estimate(c))>this.equipment.missile.range)return 'Outside nominal missile range';return '';}
 fire(guidance=this.equipment.missile.guidance){const reason=this.fireReason(guidance);if(reason){this.addLog('FIRE denied • '+reason);return null;}const c=guidance==='IR'?this.irTracks.get(this.selected):this.contacts.get(this.selected);const aim=guidance==='IR'?{x:c.x,y:c.y,z:c.z||0}:this.estimate(c);const m={id:'M'+String(++this.missileSerial).padStart(3,'0'),x:0,y:0,z:0,angle:toward({x:0,y:0},aim),speed:this.cfg.initialMissileSpeed,born:this.time,guidance,target:c.id,aim:{...aim},velocity:{x:c.vx||0,y:c.vy||0,z:c.vz||0},state:guidance==='IR'?'SEARCHING':'MIDCOURSE',alive:true,channel:false,lossTime:0,searchTime:0,acquireTime:0,acquired:null};
 if(guidance!=='IR'){const old=this.overflow();if(old){this.releaseChannel(old);if(old.guidance==='ACTIVE_RADAR')this.activateSeeker(old,'oldest channel displaced');else this.addLog(old.id+' guidance lost • oldest channel displaced');this.addLog('Channel transferred '+old.id+' → '+m.id);}if(this.equipment.channels>0){this.channels.set(m.id,m);m.channel=true;}else if(guidance==='ACTIVE_RADAR')this.activateSeeker(m,'no external channels');}
 this.missiles.push(m);this.launchers[this.launcher].loaded--;this.launchers[this.launcher].cooldown=this.cfg.launchCooldown;this.fired++;this.addLog(m.id+' launched • L'+(this.launcher+1)+' → '+c.id);return m;}
 reload(index=this.launcher){const l=this.launchers[index];if(l.reload||l.loaded>=this.cfg.roundsPerLauncher||this.reserve<=0)return;l.reload=this.cfg.reloadSeconds;this.addLog('L'+(index+1)+' reload started');}
 updateIr(){if(!this.irst)return;let capacity=this.cfg.irstCapacity;for(const a of this.interceptables().sort((a,b)=>rangeOf(a)-rangeOf(b))){if(capacity<=0)break;const r=rangeOf(a);if(r>this.cfg.irstRange*this.cfg.irWeatherFactor)continue;capacity--;const radar=this.contacts.get(a.id);const angle=Math.atan2(a.y,a.x);const estimateRange=radar?radar.range:Math.round(r/25)*25;const old=this.irTracks.get(a.id);const n={id:a.id,source:radar?'IRST + RADAR':'IRST',x:Math.cos(angle)*estimateRange,y:Math.sin(angle)*estimateRange,z:0,lastSeen:this.time,first:old?.first??this.time,bearing:bearingOf(a),range:estimateRange,rangeEstimated:!radar,tracked:false,ir:true,allegiance:radar?.allegiance||'UNKNOWN',recognized:radar?.recognized||false,type:radar?.type||null,kind:radar?.kind||null,confidence:radar?.confidence||0};if(this.time-n.first>=this.cfg.irstAcquire)this.irTracks.set(a.id,n);else this.irTracks.set(a.id,n);}
 }
 missileStep(m,dt){if(!m.alive)return;if(this.time-m.born>this.cfg.missileLifetime){this.destroyMissile(m,'flight lifetime');return;}const c=this.contacts.get(m.target);let guided=false;
 if(m.guidance==='SEMI_ACTIVE_RADAR'){const lock=this.contacts.get(this.locked);if(this.radar&&m.channel&&this.usable(lock)){const aim=this.estimate(lock);if(m.target===this.locked||fov(m,aim,this.cfg.seekerFov)){if(m.target!==this.locked)this.addLog(m.id+' illumination retarget → '+this.locked);m.target=this.locked;m.aim=aim;m.velocity={x:lock.vx,y:lock.vy,z:lock.vz};m.lossTime=0;guided=true;m.state='ILLUMINATED';}}if(!guided){if(m.lossTime===0)this.addLog(m.id+' illumination lost • coasting');m.lossTime+=dt;m.state='GUIDANCE LOST';if(m.lossTime>this.cfg.guidanceLoss){this.destroyMissile(m,'illumination timeout');return;}}}
 if(m.guidance==='ACTIVE_RADAR'&&m.state==='MIDCOURSE'){if(!this.radar||!this.usable(c)||!m.channel)this.activateSeeker(m,'external support lost');else{m.aim=this.estimate(c);m.velocity={x:c.vx,y:c.vy,z:c.vz};guided=true;if(distance(m,m.aim)<=this.cfg.seekerRange)this.activateSeeker(m,'normal activation');}}
 if(m.state==='SEARCHING'||m.state==='SEEKER LOCK'){const range=m.guidance==='IR'?this.cfg.irSeekerRange:this.cfg.seekerRange,angle=m.guidance==='IR'?this.cfg.irFov:this.cfg.seekerFov;const candidates=this.interceptables().filter(a=>distance(m,a)<=range&&fov(m,a,angle));
 let decoy=this.aviation.decoys.find(d=>d.id===m.decoy&&this.time<d.expires&&distance(m,d)<=range&&fov(m,d,angle));
 if(m.decoy&&!decoy){m.decoy=null;m.state='SEARCHING';m.searchTime=0;m.acquireTime=0;m.acquired=null;m.reacquiring=true;}
 if(!decoy)decoy=this.aviation.evaluateDecoys(m);
 if(decoy){m.decoyDwell=(m.decoyDwell||0)+dt;if(m.decoyDwell>=this.aviation.cfg.decoyAcquire){m.acquired=null;m.state='SEEKER LOCK';m.aim={x:decoy.x,y:decoy.y,z:decoy.z};m.velocity={x:0,y:0,z:0};m.searchTime=0;m.lockKind='DECOY';guided=true;}}
 let acquired=m.acquired?candidates.find(a=>a.id===m.acquired):null;
 if(!guided){
 if(acquired){m.state='SEEKER LOCK';m.aim={x:acquired.x,y:acquired.y,z:acquired.z};m.velocity={x:Math.cos(acquired.angle)*acquired.speed,y:Math.sin(acquired.angle)*acquired.speed,z:0};m.searchTime=0;m.lockKind=acquired.kind==='MISSILE'?'MISSILE':'AIRCRAFT';guided=true;}else{if(m.state==='SEEKER LOCK'){this.addLog(m.id+' seeker lock lost • reacquiring');m.state='SEARCHING';m.searchTime=0;m.acquireTime=0;m.acquired=null;m.reacquiring=true;}m.searchTime+=dt;const candidate=m.guidance==='IR'?candidates[0]:candidates.find(a=>distance(a,m.aim)<10);if(candidate){if(m.candidate!==candidate.id)m.acquireTime=0;m.candidate=candidate.id;m.acquireTime+=dt;if(m.acquireTime>=this.cfg.seekerAcquire){m.acquired=candidate.id;m.state='SEEKER LOCK';m.searchTime=0;this.addLog(m.id+' SEEKER LOCK → '+candidate.id);}}else{m.acquireTime=0;m.candidate=null;}if(m.searchTime>(m.reacquiring?this.cfg.reacquireTime:this.cfg.searchTimeout)){this.destroyMissile(m,'seeker search timeout');return;}}
 }
 }
 // All guidance paths follow a bounded turn rate and a predicted intercept.
 const aim={...m.aim};const lead=clamp(distance(m,aim)/Math.max(m.speed,.4),0,18);if(guided){aim.x+=m.velocity.x*lead;aim.y+=m.velocity.y*lead;}else{m.aim.x+=m.velocity.x*dt;m.aim.y+=m.velocity.y*dt;}
 const desired=toward(m,aim),maxTurn=rad(this.cfg.turnBaseDegrees+this.equipment.missile.maneuver*this.cfg.turnDegreesPerRating)*dt;m.angle+=clamp(diff(desired,m.angle),-maxTurn,maxTurn);m.speed=Math.min(this.cfg.missileSpeed,m.speed+this.cfg.acceleration*dt);const before={x:m.x,y:m.y,z:m.z};m.x+=Math.cos(m.angle)*m.speed*dt;m.y+=Math.sin(m.angle)*m.speed*dt;m.z+=clamp(aim.z-m.z,-m.speed*dt*.45,m.speed*dt*.45);
 // Fuse uses closest approach across the integration segment, so fast missiles cannot tunnel.
 for(const a of this.interceptables()){const d=pointSegment(a,before,m);if(d<=this.cfg.fuzeKm){const damage=this.equipment.missile.explosive*this.cfg.damageScale/(.01+d*d);a.health-=damage;this.addLog(a.id+' proximity damage '+Math.round(damage));this.effects.push({x:a.x,y:a.y,born:this.time,kill:a.health<=0});this.destroyMissile(m,'proximity detonation',false);if(a.health<=0){a.alive=false;a.ai.state='DESTROYED';if(a.kind==='MISSILE'){a.state='INTERCEPTED';this.intercepts++;this.addLog(a.id+' incoming missile intercepted');}else{this.kills++;this.addLog(a.id+' destroyed');}this.removeContact(a.id);}else if(a.health<a.cfg.abortHealth){transition(a,'DISENGAGE',this.time,this.aviation.trace,'damage threshold');this.addLog(a.id+' critically damaged • retreating');}break;}}
 }
 removeContact(id){this.contacts.delete(id);this.irTracks.delete(id);if(this.locked===id)this.locked=null;if(this.lockAttempt?.id===id)this.lockAttempt=null;if(this.selected===id){this.selected=null;this.nextTarget();}}
 destroyMissile(m,why,log=true){m.alive=false;this.releaseChannel(m);if(log)this.addLog(m.id+' self-destruct • '+why);}

 step(dt){if(this.ended)return;for(let remaining=dt;remaining>1e-8;){const s=Math.min(.05,remaining);this.tick(s);remaining-=s;if(this.ended)break;}}
 tick(dt){this.time+=dt;for(const [kind,sw]of Object.entries(this.switches)){sw.remaining-=dt;if(sw.remaining<=0){this[kind]=sw.target;delete this.switches[kind];this.addLog(kind.toUpperCase()+' '+(this[kind]?'ON':'OFF'));if(kind==='radar'&&!this.radar){this.locked=null;this.lockAttempt=null;this.guidanceConsequences();}}}
 this.aviation.tick(dt);this.hostileWeapons.tick(dt);
 if(this.radar){const previous=this.phase,advance=TAU*dt/sweepInterval(this.cfg.scanRating);this.phase=(this.phase+advance)%TAU;for(const a of this.interceptables()){const az=rad(bearingOf(a));const crossed=((az-previous+TAU)%TAU)<=advance;if(crossed)this.measure(a);}this.allocateTracks();}
 for(const c of this.contacts.values()){if(c.tracked&&this.time-c.trackTime>this.cfg.trackTimeout){c.tracked=false;c.history=[];delete c.trackX;delete c.trackY;this.addLog(c.id+' TWS track expired');}if(this.time-c.lastSeen>this.cfg.contactTimeout){this.contacts.delete(c.id);this.addLog(c.id+' contact faded');}}
 if(this.time-this.lastIr>=this.cfg.irstInterval){this.lastIr=this.time;this.updateIr();}for(const [id,c]of this.irTracks)if(this.time-c.lastSeen>this.cfg.coastTime)this.irTracks.delete(id);
 if(this.lockAttempt){const c=this.contacts.get(this.lockAttempt.id);if(!this.radar||!this.usable(c)||falloff(rangeOf(this.estimate(c)),this.equipment.lock,this.cfg.outerRangeFactor)<this.cfg.launchQuality){this.addLog('Lock acquisition failed • track or range quality');this.lockAttempt=null;}else{this.lockAttempt.elapsed+=dt;if(this.lockAttempt.elapsed>=this.cfg.lockAcquire){this.locked=c.id;this.lockAttempt=null;this.addLog(c.id+' RADAR LOCK acquired');}}}
 if(this.locked){const c=this.contacts.get(this.locked);const good=this.radar&&this.usable(c)&&falloff(rangeOf(this.estimate(c)),this.equipment.lock,this.cfg.outerRangeFactor)>=this.cfg.launchQuality;this.lockLostFor=good?0:this.lockLostFor+dt;if(this.lockLostFor>this.cfg.lockTolerance){this.addLog(this.locked+' radar lock lost');this.locked=null;}}
 for(const m of this.missiles)this.missileStep(m,dt);for(const [i,l]of this.launchers.entries()){l.cooldown=Math.max(0,l.cooldown-dt);if(l.reload>0){l.reload-=dt;if(l.reload<=0){l.reload=0;const rounds=Math.min(this.reserve,this.cfg.roundsPerLauncher-l.loaded);l.loaded+=rounds;this.reserve-=rounds;this.addLog('L'+(i+1)+' reload complete');}}if(!l.loaded&&!l.reload&&this.reserve)this.reload(i);}
 this.effects=this.effects.filter(e=>this.time-e.born<2);this.missiles=this.missiles.filter(m=>m.alive||this.time-m.born<5);
 if(this.time>=this.nextSpawn){this.nextSpawn+=this.cfg.spawnInterval;if(this.aircraft.filter(a=>a.alive&&!a.retreat).length<this.cfg.maxAircraft)this.spawn();}if(this.time>=this.cfg.scenarioSeconds){this.ended=true;this.addLog('Exercise complete • '+this.kills+' kills / '+this.intercepts+' interceptions');}
 }
}

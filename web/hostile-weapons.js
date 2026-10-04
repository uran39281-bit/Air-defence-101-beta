import {RUSSIAN_WEAPON_CATALOGUE} from './weapon-catalogue.js';

// Editable gameplay envelopes, not real aircraft compatibility or missile
// performance. The carrier assignments are fictional exercise loadouts. Mach
// reference values stay in the catalogue; km/s caps below are balance choices.
const profile = (id, values) => Object.freeze({
  id, referenceId: id === 'KH31PD' ? 'Kh-31PD' : id === 'KH38MT' ? 'Kh-38MT' : 'Kh-29TD',
  proposedGameplay: true, carrierCompatibilityVerified: false,
  launchMinSpeed: .08, launchMaxSpeed: .85, health: 35, hitRadius: .085,
  seekerFov: 65, acceleration: .045, memoryDrift: .0018,
  ...values,
});
export const HOSTILE_WEAPON_PROFILES = Object.freeze({
  KH31PD: profile('KH31PD', {
    name: 'Kh-31PD', guidance: 'PASSIVE_RADAR', category: 'ANTI_RADIATION',
    launchRange: 140, minRange: 15, minAltitude: .6, maxAltitude: 18,
    launchHeadingTolerance: 24, launchDwell: 1.5, launchCooldown: 14, standoffRange: 110,
    maxSpeed: 1.05, lifetime: 230, turnDegrees: 16, signature: .19,
    emitterMemory: 10, emitterBearingTolerance: 25, sensorRange: 100,
    abstraction: 'Perceived RWR bearing authorizes launch; onboard passive sensor updates a noisy emitter fix. Radar silence leaves imperfect inertial memory.',
  }),
  KH38MT: profile('KH38MT', {
    name: 'Kh-38MT', guidance: 'INERTIAL_IR', category: 'AIR_TO_GROUND',
    launchRange: 65, minRange: 5, minAltitude: .4, maxAltitude: 12,
    launchHeadingTolerance: 18, launchDwell: 2, launchCooldown: 12, standoffRange: 50,
    maxSpeed: .67, lifetime: 160, turnDegrees: 13, signature: .14,
    sensorRange: 12,
    abstraction: 'Assigned point target with inertial navigation and simplified IR terminal correction; no carrier radar lock or automatic aircraft warning.',
  }),
  KH29TD: profile('KH29TD', {
    name: 'Kh-29TD', guidance: 'TV_POINT', category: 'AIR_TO_GROUND',
    launchRange: 32, minRange: 3, minAltitude: .4, maxAltitude: 12,
    launchHeadingTolerance: 14, launchDwell: 2, launchCooldown: 15, standoffRange: 25,
    maxSpeed: .54, lifetime: 70, turnDegrees: 11, signature: .22,
    sensorRange: 16,
    abstraction: 'Assigned point target and simplified autonomous TV terminal correction; weather and contrast are editable, without modeling a remote TV console.',
  }),
});

const rad = degrees => degrees * Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const delta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
const direction = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const headingBearing = angle => (angle * 180 / Math.PI + 90 + 360) % 360;
const pointValid = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
const pointSegmentDistance = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / (dx * dx + dy * dy + dz * dz || 1), 0, 1);
  return distance(p, {x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t});
};
const normalizeId = id => String(id || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

export class HostileWeapons {
  constructor(sim, options = {}) {
    this.sim = sim;
    this.cfg = {targetContrast: 1, weatherVisibility: 1, terminalBiasKm: .025,
      lineOfSight: options.lineOfSight || sim.aviation?.lineOfSight || (() => true), ...options};
    this.profiles = Object.fromEntries(Object.entries(HOSTILE_WEAPON_PROFILES)
      .map(([id, p]) => [id, Object.freeze({...p, ...options.profiles?.[id]})]));
    this.serial = 0;
    if (!Array.isArray(sim.hostileMissiles)) sim.hostileMissiles = [];
  }

  profile(a) { return this.profiles[normalizeId(a?.missileWeaponID)] || null; }

  reference(a) {
    const p = this.profile(a);
    return p ? RUSSIAN_WEAPON_CATALOGUE.find(w => w.id === p.referenceId) : null;
  }

  emitterEvidence(a, p = this.profile(a)) {
    if (!p || !pointValid(a.mission?.objective)) return null;
    const targetBearing = headingBearing(direction(a, a.mission.objective));
    return [...(a.perception?.warnings?.values() || [])]
      .filter(w => w.source === 'RWR' && ['SEARCH', 'FIRE CONTROL', 'ILLUMINATION'].includes(w.class)
        && Number.isFinite(w.bearing) && Number.isFinite(w.time) && w.time <= this.sim.time
        && this.sim.time - w.time <= p.emitterMemory && this.sim.time <= w.expires
        && Math.abs(delta(rad(w.bearing), rad(targetBearing))) <= rad(p.emitterBearingTolerance))
      .sort((a, b) => b.time - a.time || b.confidence - a.confidence)[0] || null;
  }

  envelopeReason(a, p = this.profile(a)) {
    if (!p) return 'No enabled hostile missile profile';
    if (!pointValid(a.mission?.objective)) return 'No assigned point target';
    if (!pointValid(a)) return 'Invalid carrier position';
    const range = distance(a, a.mission.objective);
    if (range > p.launchRange || range < p.minRange) return 'Outside hostile launch range';
    if (a.z < p.minAltitude || a.z > p.maxAltitude) return 'Outside hostile release altitude';
    if (!Number.isFinite(a.speed) || a.speed < p.launchMinSpeed || a.speed > p.launchMaxSpeed) return 'Outside hostile release speed';
    if (!Number.isFinite(a.angle) || Math.abs(delta(direction(a, a.mission.objective), a.angle)) > rad(p.launchHeadingTolerance)) return 'Hostile launch heading unstable';
    return '';
  }

  launchReason(a) {
    const p = this.profile(a), s = this.sim;
    if (s.cfg.hostileMissilesEnabled === false) return 'Hostile missiles disabled';
    if (s.ended) return 'Exercise complete';
    if (!a?.alive || a.exited || a.retreat || ['DISENGAGE', 'DESTROYED', 'EXITED', 'DEFENSIVE', 'MISSILE EVASION'].includes(a.ai?.state)) return 'Carrier unavailable or defending';
    if (a.missileAttackAuthorized !== true) return 'Attack decision has not authorized release';
    if (!Number.isInteger(a.missilesRemaining) || a.missilesRemaining <= 0) return 'Hostile missile inventory empty';
    if (s.time < (a.missileReady || 0)) return 'Hostile missile launch cooldown';
    const reason = this.envelopeReason(a, p);
    if (reason) return reason;
    if ((a.missileStableFor || 0) < p.launchDwell) return 'Hostile launch solution acquiring';
    // Aircraft decisions have no access to s.radar, target selection, locks,
    // player missiles or ammunition. Even an ARM needs received evidence.
    if (p.guidance === 'PASSIVE_RADAR' && !this.emitterEvidence(a, p)) return 'No perceived matching radar emitter';
    return '';
  }

  canLaunch(a) { return this.launchReason(a) === ''; }

  launch(a) {
    if (!this.canLaunch(a)) return null;
    const s = this.sim, p = this.profile(a), target = {...a.mission.objective};
    const noise = typeof a.rng === 'function' ? a.rng() : .5;
    const side = noise < .5 ? -1 : 1;
    const seedBias = this.cfg.terminalBiasKm * (.5 + Math.abs(noise - .5));
    const targetAngle = direction(a, target);
    const errorAxis = {x: -Math.sin(targetAngle), y: Math.cos(targetAngle)};
    const m = {
      id: 'H' + String(++this.serial).padStart(3, '0'), kind: 'MISSILE', type: p.name, name: p.name,
      weaponID: p.id, owner: a.id, alive: true, allegiance: 'HOSTILE', born: s.time,
      x: a.x, y: a.y, z: a.z, angle: a.angle, speed: clamp(a.speed, .1, p.maxSpeed),
      health: p.health, signature: p.signature, stealth: 0, heat: .6,
      guidance: p.guidance, state: p.guidance === 'PASSIVE_RADAR' ? 'EMITTER SEARCH' : 'POINT NAVIGATION',
      target, aim: {...target, x: target.x + errorAxis.x * side * seedBias,
        y: target.y + errorAxis.y * side * seedBias}, lastEmitterPosition: null, errorAxis,
      inertialUncertainty: 0, driftSide: side, terminalBias: side * seedBias,
      ai: {state: 'IN FLIGHT'}, cfg: {abortHealth: -Infinity}, velocity: {x: 0, y: 0, z: 0},
      profile: p, detonationRecorded: false,
    };
    if (p.guidance === 'PASSIVE_RADAR') {
      const w = this.emitterEvidence(a, p);
      m.emitterObservation = {bearing: w.bearing, confidence: w.confidence, time: w.time};
      m.lastEmitterPosition = {...m.aim};
    }
    a.missilesRemaining--;
    a.missileReady = s.time + p.launchCooldown;
    a.missileStableFor = 0;
    s.hostileMissiles.push(m);
    // The engine reports releases only when player sensors observe them.
    // Logging policy cannot feed hidden player state into the launch decision.
    s.observeHostileRelease?.(a, m);
    return m;
  }

  senseEmitter(m) {
    // This is the missile's onboard sensor, not the aircraft's decision input.
    // Continuous illumination is simplified to detectable battery emission;
    // finite range, FOV and LOS still apply. It cannot sense a silent radar.
    const p = m.profile, s = this.sim, emitter = {x: 0, y: 0, z: 0};
    return s.radar && distance(m, emitter) <= p.sensorRange
      && Math.abs(delta(direction(m, emitter), m.angle)) <= rad(p.seekerFov / 2)
      && this.cfg.lineOfSight(m, emitter, s.time) ? emitter : null;
  }

  guide(m, dt) {
    const p = m.profile, s = this.sim;
    if (p.guidance === 'PASSIVE_RADAR') {
      const emitter = this.senseEmitter(m);
      if (emitter) {
        m.lastEmitterPosition = {...emitter,
          x: emitter.x + m.errorAxis.x * m.terminalBias,
          y: emitter.y + m.errorAxis.y * m.terminalBias};
        m.inertialUncertainty = 0; m.aim = {...m.lastEmitterPosition};
        m.state = 'PASSIVE HOMING';
      } else {
        m.inertialUncertainty += p.memoryDrift * dt;
        m.aim = {...m.lastEmitterPosition,
          x: m.lastEmitterPosition.x + m.errorAxis.x * m.driftSide * m.inertialUncertainty,
          y: m.lastEmitterPosition.y + m.errorAxis.y * m.driftSide * m.inertialUncertainty};
        m.state = 'INERTIAL MEMORY';
      }
    } else {
      const terminal = distance(m, m.target) <= p.sensorRange
        && Math.abs(delta(direction(m, m.target), m.angle)) <= rad(p.seekerFov / 2)
        && this.cfg.lineOfSight(m, m.target, s.time);
      const vision = p.guidance !== 'TV_POINT' || this.cfg.targetContrast * this.cfg.weatherVisibility >= .35;
      if (terminal && vision) {
        m.terminalLoss = 0;
        m.aim = {...m.target, x: m.target.x + m.errorAxis.x * m.terminalBias,
          y: m.target.y + m.errorAxis.y * m.terminalBias};
        m.state = p.guidance === 'TV_POINT' ? 'TV TERMINAL' : 'IR TERMINAL';
      } else if (terminal && !vision) {
        m.terminalLoss = (m.terminalLoss || 0) + dt;
        const error = m.terminalBias + m.driftSide * .012 * m.terminalLoss;
        m.aim = {...m.target, x: m.target.x + m.errorAxis.x * error,
          y: m.target.y + m.errorAxis.y * error};
        m.state = 'TV MEMORY';
      } else m.state = 'POINT NAVIGATION';
    }
  }

  expire(m, reason) {
    const observed = this.sim.contacts?.has(m.id) || this.sim.irTracks?.has(m.id);
    m.alive = false; m.state = reason; m.ai.state = reason;
    this.sim.removeContact?.(m.id);
    if (observed && reason !== 'BATTERY IMPACT') this.sim.addLog?.(m.id + ' track ended • ' + reason.toLowerCase());
  }

  flightStep(m, dt) {
    if (!m.alive) return;
    const s = this.sim, p = m.profile;
    if (s.time - m.born >= p.lifetime) return this.expire(m, 'FLIGHT EXPIRED');
    this.guide(m, dt);
    const before = {x: m.x, y: m.y, z: m.z};
    const desired = direction(m, m.aim), maxTurn = rad(p.turnDegrees) * dt;
    m.angle += clamp(delta(desired, m.angle), -maxTurn, maxTurn);
    m.speed = Math.min(p.maxSpeed, m.speed + p.acceleration * dt);
    const dx = Math.cos(m.angle) * m.speed * dt, dy = Math.sin(m.angle) * m.speed * dt;
    const horizontalRemaining = Math.hypot(m.aim.x - m.x, m.aim.y - m.y);
    // A bounded descent follows the remaining slant path. The terminal step
    // may pass through ground, allowing segment collision rather than tunneling.
    const vz = clamp((m.aim.z - m.z) * m.speed / Math.max(horizontalRemaining, .05), -m.speed * .8, m.speed * .8);
    m.x += dx; m.y += dy; m.z += vz * dt;
    m.velocity = {x: dx / dt, y: dy / dt, z: vz};
    if (pointSegmentDistance({x: 0, y: 0, z: 0}, before, m) <= p.hitRadius && !m.detonationRecorded) {
      m.detonationRecorded = true;
      s.hits = Math.min(s.cfg.maxPlayerHits, s.hits + 1);
      s.effects?.push({x: m.x, y: m.y, born: s.time, kill: false});
      this.expire(m, 'BATTERY IMPACT');
      s.addLog?.('Hostile missile impact • battery hit ' + s.hits + '/' + s.cfg.maxPlayerHits);
      if (s.hits >= s.cfg.maxPlayerHits) {s.ended = true; s.addLog?.('Battery lost • exercise ended');}
    } else if (m.z <= 0 || Math.hypot(m.x, m.y) > 850) {
      s.effects?.push({x: m.x, y: m.y, born: s.time, kill: false});
      this.expire(m, 'GROUND MISS');
    }
  }

  tick(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const a of this.sim.aircraft) {
      const p = this.profile(a);
      if (!p) continue;
      const stable = this.sim.cfg.hostileMissilesEnabled !== false && a.alive && !a.retreat
        && a.missileAttackAuthorized === true && !this.envelopeReason(a, p);
      a.missileStableFor = stable ? (a.missileStableFor || 0) + dt : 0;
    }
    // Flight and guidance never depend on the launching carrier staying alive.
    for (const m of this.sim.hostileMissiles) this.flightStep(m, dt);
    this.sim.hostileMissiles = this.sim.hostileMissiles.filter(m => m.alive || this.sim.time - m.born < 5);
  }
}

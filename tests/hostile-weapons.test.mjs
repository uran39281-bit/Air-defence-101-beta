import test from 'node:test';
import assert from 'node:assert/strict';
import {HostileWeapons, HOSTILE_WEAPON_PROFILES} from '../web/hostile-weapons.js';

function exercise(weaponID = 'KH38MT', options = {}) {
  const sim = {time: 0, cfg: {maxPlayerHits: 4}, hits: 0, ended: false,
    radar: true, aircraft: [], hostileMissiles: [], effects: [], log: [],
    addLog(message) {this.log.push({time: this.time, message});},
    removeContact(id) {this.removed = id;}};
  const aircraft = {id: 'C001', type: 'Su-27', alive: true, retreat: false, exited: false,
    x: 28, y: 0, z: 2, angle: Math.PI, speed: .4,
    health: 100, ai: {state: 'MISSILE ATTACK'},
    mission: {objective: {x: 0, y: 0, z: 0}},
    missileWeaponID: weaponID, missilesRemaining: 2, missileReady: 0,
    missileAttackAuthorized: true, missileStableFor: 3, rng: () => .25,
    perception: {warnings: new Map([['RX-1', {source: 'RWR', class: 'SEARCH',
      bearing: 270, confidence: .8, time: 0, expires: 10}]])}};
  sim.aircraft.push(aircraft);
  const weapons = new HostileWeapons(sim, options);
  function step(seconds) {
    for (let remaining = seconds; remaining > 1e-8;) {
      const dt = Math.min(.05, remaining); sim.time += dt; weapons.tick(dt); remaining -= dt;
    }
  }
  return {sim, aircraft, weapons, step};
}

test('release consumes finite rounds and launches a physical hostile contact without immediate damage', () => {
  const {sim, aircraft: a, weapons} = exercise();
  const first = weapons.launch(a);
  assert.ok(first); assert.equal(first.id, 'H001'); assert.equal(first.kind, 'MISSILE');
  assert.equal(first.allegiance, 'HOSTILE'); assert.equal(sim.hits, 0);
  assert.equal(a.missilesRemaining, 1); assert.equal(sim.hostileMissiles.length, 1);
  assert.equal(weapons.launch(a), null, 'Cooldown prevents an immediate salvo');
  sim.time = a.missileReady; a.missileStableFor = 3;
  assert.equal(weapons.launch(a).id, 'H002'); assert.equal(a.missilesRemaining, 0);
  sim.time += 100; a.missileStableFor = 3;
  assert.equal(weapons.launch(a), null, 'An empty carrier cannot manufacture rounds');
});

test('launch requires AI authorization, alignment, dwell and altitude rather than radius alone', () => {
  const {aircraft: a, weapons} = exercise();
  a.missileAttackAuthorized = false; assert.equal(weapons.launch(a), null);
  a.missileAttackAuthorized = true; a.angle = 0; assert.equal(weapons.launch(a), null);
  a.angle = Math.PI; a.missileStableFor = 0; assert.equal(weapons.launch(a), null);
  a.missileStableFor = 3; a.z = 20; assert.equal(weapons.launch(a), null);
  a.z = 2; a.ai.state = 'MISSILE EVASION'; assert.equal(weapons.launch(a), null);
  a.ai.state = 'MISSILE ATTACK'; assert.ok(weapons.launch(a));
});

test('anti-radiation launch uses perceived evidence and never reads hidden radar or player controls', () => {
  const {sim, aircraft: a, weapons} = exercise('KH31PD');
  for (const key of ['radar', 'selected', 'locked', 'contacts', 'missiles', 'channels']) {
    Object.defineProperty(sim, key, {configurable: true, get() {throw Error('Hidden AI input: ' + key);}});
  }
  a.perception.warnings.clear(); assert.equal(weapons.launch(a), null);
  a.perception.warnings.set('RX-1', {source: 'RWR', class: 'SEARCH', bearing: 90,
    confidence: .8, time: 0, expires: 10});
  assert.equal(weapons.launch(a), null, 'A radar behind the mission direction is not the assigned emitter');
  a.perception.warnings.get('RX-1').bearing = 270;
  assert.ok(weapons.launch(a));
});

test('stale or missile-seeker warnings cannot authorize a new anti-radiation shot', () => {
  const {sim, aircraft: a, weapons} = exercise('KH31PD');
  sim.time = 11; assert.equal(weapons.launch(a), null);
  sim.time = 0; a.perception.warnings.get('RX-1').class = 'MISSILE SEEKER';
  assert.equal(weapons.launch(a), null);
  a.perception.warnings.get('RX-1').class = 'SEARCH';
  a.perception.warnings.get('RX-1').time = 1;
  assert.equal(weapons.launch(a), null, 'A future observation is not knowledge');
});

test('normal point-guided flight advances, survives carrier death, and hits only at physical arrival', () => {
  const {sim, aircraft: a, weapons, step} = exercise();
  const m = weapons.launch(a); a.alive = false;
  step(1); assert.ok(m.x < 28); assert.equal(sim.hits, 0); assert.equal(m.alive, true);
  step(70); assert.equal(m.alive, false); assert.equal(m.state, 'BATTERY IMPACT');
  assert.equal(sim.hits, 1); step(5); assert.equal(sim.hits, 1, 'Impact cannot count twice');
});

test('radar silence changes passive homing to imperfect memory without magically deleting the missile', () => {
  const {sim, aircraft: a, weapons, step} = exercise('KH31PD');
  a.x = 90; const m = weapons.launch(a); a.missileAttackAuthorized = false;
  step(1); assert.equal(m.state, 'PASSIVE HOMING');
  sim.radar = false; const previousAim = {...m.aim};
  step(2); assert.equal(m.alive, true); assert.equal(m.state, 'INERTIAL MEMORY');
  assert.ok(m.inertialUncertainty > 0); assert.ok(Math.hypot(m.aim.x - previousAim.x, m.aim.y - previousAim.y) > 0);
  sim.radar = true; step(.1); assert.equal(m.state, 'PASSIVE HOMING');
  assert.equal(m.inertialUncertainty, 0, 'Onboard reacquisition resets navigation uncertainty');
});

test('point-guided missiles retain their assigned target when battery radar is off', () => {
  for (const weaponID of ['KH38MT', 'KH29TD']) {
    const {sim, aircraft: a, weapons, step} = exercise(weaponID);
    const m = weapons.launch(a); a.missileAttackAuthorized = false; sim.radar = false;
    step(70); assert.equal(m.state, 'BATTERY IMPACT', weaponID); assert.equal(sim.hits, 1);
  }
});

test('finite missile life ends without damaging a distant battery', () => {
  const {sim, aircraft: a, weapons, step} = exercise('KH38MT', {profiles: {KH38MT: {lifetime: 1}}});
  const m = weapons.launch(a); a.missileAttackAuthorized = false;
  step(2); assert.equal(m.alive, false); assert.equal(m.state, 'FLIGHT EXPIRED'); assert.equal(sim.hits, 0);
});

test('poor terminal TV visibility produces navigation error instead of perfect hidden target guidance', () => {
  const {sim, aircraft: a, weapons, step} = exercise('KH29TD', {weatherVisibility: 0});
  const m = weapons.launch(a); a.missileAttackAuthorized = false;
  step(71); assert.equal(m.alive, false); assert.equal(sim.hits, 0);
  assert.ok(m.terminalLoss > 0); assert.ok(['GROUND MISS', 'FLIGHT EXPIRED'].includes(m.state));
});

test('weapon tick acquires dwell but aircraft decision owns the actual release', () => {
  const {sim, aircraft: a, weapons, step} = exercise();
  a.missileStableFor = 0; step(3);
  assert.equal(sim.hostileMissiles.length, 0); assert.equal(a.missilesRemaining, 2);
  assert.ok(weapons.canLaunch(a)); assert.ok(weapons.launch(a));
});

test('the fourth physical hostile impact ends the battery exercise', () => {
  const {sim, aircraft: a, weapons, step} = exercise();
  sim.hits = 3; weapons.launch(a); a.missileAttackAuthorized = false;
  step(70); assert.equal(sim.hits, 4); assert.equal(sim.ended, true);
});

test('controlled scenarios can disable new hostile releases without erasing an airborne round', () => {
  const {sim, aircraft: a, weapons, step} = exercise();
  sim.cfg.hostileMissilesEnabled = false;
  assert.equal(weapons.launchReason(a), 'Hostile missiles disabled'); assert.equal(weapons.launch(a), null);
  sim.cfg.hostileMissilesEnabled = true; const m = weapons.launch(a);
  sim.cfg.hostileMissilesEnabled = false; a.missileAttackAuthorized = false;
  step(1); assert.equal(m.alive, true); assert.ok(m.x < 28);
});

test('only sensor-observed flight expiration appears in the player log', () => {
  const hidden = exercise('KH38MT', {profiles: {KH38MT: {lifetime: 1}}});
  const unobserved = hidden.weapons.launch(hidden.aircraft); hidden.aircraft.missileAttackAuthorized = false;
  hidden.step(2); assert.equal(unobserved.alive, false); assert.equal(hidden.sim.log.length, 0);
  const seen = exercise('KH38MT', {profiles: {KH38MT: {lifetime: 1}}});
  const observed = seen.weapons.launch(seen.aircraft); seen.aircraft.missileAttackAuthorized = false;
  seen.sim.contacts = new Map([[observed.id, {tracked: true}]]);
  seen.step(2); assert.ok(seen.sim.log.some(e => e.message.includes('track ended')));
});

test('provisional flight profiles remain separate from unchanged Wiki reference ranges and Mach values', () => {
  const {aircraft: a, weapons} = exercise('Kh-31PD');
  assert.equal(weapons.profile(a), weapons.profiles.KH31PD);
  assert.equal(HOSTILE_WEAPON_PROFILES.KH31PD.launchRange, 140);
  assert.equal(weapons.reference(a).launchRangeKm, 250);
  assert.equal(weapons.reference(a).maxSpeedMach, 4);
  assert.equal(weapons.profile(a).carrierCompatibilityVerified, false);
});

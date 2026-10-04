import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation, rangeOf} from '../web/engine.js';
import {ICONS} from '../web/config.js';

const exercise = options => new Simulation({startAircraft: 0, spawnInterval: 1e9,
  scenarioSeconds: 1e9, ...options});

function launchIncoming(sim, position = {}) {
  const carrier = sim.spawn(1, {preset: 'WP-3', missileWeaponID: 'KH38MT', routeVariation: false});
  Object.assign(carrier, {x: 40, y: 0, z: 2, angle: Math.PI, speed: .4,
    missileStableFor: 3, missileAttackAuthorized: true, ...position});
  const missile = sim.hostileWeapons.launch(carrier);
  assert.ok(missile, sim.hostileWeapons.launchReason(carrier));
  // No new releases or bomb impacts interfere with the controlled encounter.
  carrier.alive = false;
  return {carrier, missile};
}

function waitFor(sim, predicate, timeout = 20) {
  const limit = sim.time + timeout;
  while (sim.time < limit && !predicate()) sim.step(.05);
  assert.ok(predicate(), 'Timed out waiting for modeled sensor evidence');
}

test('incoming rounds acquire radar classification and automatic TWS through repeated actual sweeps', () => {
  const sim = exercise(), {missile} = launchIncoming(sim);
  assert.equal(sim.contacts.size, 0);
  waitFor(sim, () => sim.contacts.has(missile.id));
  const first = sim.contacts.get(missile.id);
  assert.equal(first.allegiance, 'UNKNOWN'); assert.equal(first.recognized, false);
  assert.equal(first.kind, undefined); assert.equal(first.guidance, undefined);
  assert.equal(first.type, null, 'A first return must not reveal the exact weapon');
  waitFor(sim, () => sim.usable(sim.contacts.get(missile.id)));
  const tracked = sim.contacts.get(missile.id);
  assert.equal(tracked.kind, 'MISSILE'); assert.equal(tracked.type, 'MISSILE');
  assert.equal(tracked.allegiance, 'HOSTILE'); assert.equal(tracked.recognized, true);
  assert.ok(tracked.history.length >= 2); assert.ok(Number.isFinite(tracked.speed));
  assert.equal(sim.icon(tracked), ICONS.hostileMissile);
  assert.ok(sim.log.some(e => e.message.includes(missile.id + ' INCOMING MISSILE')));
});

test('a SAM fired from an acquired missile TWS physically intercepts the airborne hostile round', () => {
  const sim = exercise(), {missile: hostile} = launchIncoming(sim);
  waitFor(sim, () => sim.usable(sim.contacts.get(hostile.id)));
  sim.select(hostile.id);
  const ammunition = sim.launchers[0].loaded, initialRange = rangeOf(hostile);
  const interceptor = sim.fire();
  assert.ok(interceptor); assert.equal(interceptor.target, hostile.id);
  assert.equal(sim.locked, null, 'An active SAM can use TWS without a hard lock');
  assert.equal(sim.launchers[0].loaded, ammunition - 1);
  assert.equal(hostile.alive, true); assert.equal(sim.intercepts, 0); assert.equal(sim.hits, 0);
  sim.step(1);
  assert.ok(rangeOf(interceptor) > 0); assert.ok(rangeOf(hostile) < initialRange);
  assert.equal(sim.intercepts, 0, 'Launching an interceptor must not produce an instant hit');
  waitFor(sim, () => !hostile.alive, 40);
  assert.equal(hostile.state, 'INTERCEPTED'); assert.equal(sim.intercepts, 1);
  assert.equal(sim.kills, 0, 'Weapon interceptions are separate from aircraft kills');
  assert.equal(sim.hits, 0); assert.equal(interceptor.alive, false);
  assert.equal(sim.contacts.has(hostile.id), false);
  sim.step(60); assert.equal(sim.hits, 0, 'An intercepted round cannot later hit the battery');
});

test('an observed missile preempts a closer aircraft when automatic track capacity is full', () => {
  const sim = exercise({equipment: {tracks: 1}});
  const aircraft = sim.spawn(2, {preset: 'WP-0', routeVariation: false,
    mission: {intrusion: {x: 100, y: -100, z: 18}}});
  Object.assign(aircraft, {x: 10, y: -15, z: 18});
  waitFor(sim, () => sim.usable(sim.contacts.get(aircraft.id)));
  assert.equal(sim.trackCount(), 1);
  const {missile} = launchIncoming(sim);
  waitFor(sim, () => sim.usable(sim.contacts.get(missile.id)));
  assert.ok(sim.contacts.get(aircraft.id).range < sim.contacts.get(missile.id).range);
  assert.equal(sim.contacts.get(aircraft.id).tracked, false);
  assert.equal(sim.contacts.get(missile.id).tracked, true); assert.equal(sim.trackCount(), 1);
  assert.ok(sim.log.some(e => e.message.includes('TWS slot reassigned to incoming missile')));
});

test('radar OFF exposes no raw missile positions and identification waits for new sensor evidence', () => {
  const sim = exercise(); sim.radar = false;
  const {missile} = launchIncoming(sim);
  sim.step(10);
  assert.equal(missile.alive, true); assert.equal(sim.contacts.size, 0); assert.equal(sim.visible().length, 0);
  assert.equal(sim.log.some(e => e.message.includes('possible weapon release')), false);
  assert.equal(sim.log.some(e => e.message.includes('INCOMING MISSILE')), false);
  sim.radar = true;
  waitFor(sim, () => sim.contacts.has(missile.id));
  assert.equal(sim.contacts.get(missile.id).recognized, false);
  assert.equal(sim.contacts.get(missile.id).allegiance, 'UNKNOWN');
  waitFor(sim, () => sim.contacts.get(missile.id)?.kind === 'MISSILE');
  assert.ok(sim.log.some(e => e.message.includes('INCOMING MISSILE')));
});

test('release reports require an observed carrier and never reveal exact weapon or guidance', () => {
  const hidden = exercise(); launchIncoming(hidden);
  assert.equal(hidden.log.some(e => e.message.includes('possible weapon release')), false);

  const observed = exercise(), carrier = observed.spawn(1, {preset: 'WP-3',
    missileWeaponID: 'KH38MT', routeVariation: false});
  Object.assign(carrier, {x: 40, y: 0, z: 2, angle: Math.PI, speed: .4,
    missileStableFor: 3, missileAttackAuthorized: true});
  // These measurements represent observed carrier returns, with acquisition
  // time and distinct positions rather than directly manufacturing a track.
  observed.measure(carrier); observed.time = 3; carrier.x -= 1.2;
  observed.measure(carrier); observed.allocateTracks();
  assert.ok(observed.usable(observed.contacts.get(carrier.id)));
  assert.ok(observed.hostileWeapons.launch(carrier));
  const reports = observed.log.filter(e => e.message.includes('possible weapon release'));
  assert.equal(reports.length, 1);
  assert.match(reports[0].message, /watch for incoming contacts/);
  assert.doesNotMatch(reports[0].message, /Kh-38|INERTIAL|IR TERMINAL|H001/);
  assert.equal(observed.contacts.has('H001'), false, 'Seeing a carrier release does not create a missile track');
});

test('RESET clears missile radar knowledge while preserving airborne enemy rounds and consumed inventory', () => {
  const sim = exercise(), {carrier, missile} = launchIncoming(sim);
  waitFor(sim, () => sim.usable(sim.contacts.get(missile.id)));
  const ammo = carrier.missilesRemaining, position = {x: missile.x, y: missile.y, z: missile.z};
  sim.resetRadar();
  assert.equal(sim.contacts.size, 0); assert.equal(missile.alive, true);
  assert.ok(sim.hostileMissiles.includes(missile)); assert.equal(carrier.missilesRemaining, ammo);
  assert.deepEqual({x: missile.x, y: missile.y, z: missile.z}, position);
  sim.step(.2); assert.ok(missile.x < position.x); assert.equal(missile.alive, true);
});

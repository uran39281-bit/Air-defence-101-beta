import test from 'node:test';
import assert from 'node:assert/strict';
import {FIELD_STATUS, RUSSIAN_WEAPON_CATALOGUE, WEAPON_VARIANT_NOTES, findWeapon} from '../web/weapon-catalogue.js';
import {WEAPON_PRESETS, AI_DEFAULTS} from '../web/aircraft-config.js';

test('catalogue retains specific variants and never enables new gameplay presets', () => {
  assert.equal(RUSSIAN_WEAPON_CATALOGUE.length, 25);
  assert.equal(new Set(RUSSIAN_WEAPON_CATALOGUE.map(w => w.id)).size, 25);
  assert.equal(RUSSIAN_WEAPON_CATALOGUE.filter(w => w.role === 'AIR_TO_AIR').length, 6);
  assert.equal(RUSSIAN_WEAPON_CATALOGUE.filter(w => w.category === 'UNGUIDED_BOMB').length, 7);
  assert.ok(RUSSIAN_WEAPON_CATALOGUE.every(w => w.referenceOnly && !w.gameplayEnabled));
  assert.equal(WEAPON_PRESETS['WP-2'].enabled, false);
  assert.equal(WEAPON_PRESETS['WP-3'].enabled, false);
  assert.equal(WEAPON_PRESETS['WP-1'].weapon, 'BETA-BOMB-250');
  assert.equal(AI_DEFAULTS.bombDefinition, 'BETA-BOMB-250');
  for (const ambiguous of ['FAB-500M', 'FAB-3000M', 'R-27', 'Kh-58U', 'KH-58SHK']) assert.equal(findWeapon(ambiguous), null);
  const assumption = WEAPON_VARIANT_NOTES.find(w => w.input === 'KH-58SHK');
  assert.equal(assumption.assumedWeaponId, 'Kh-58UShK');
  assert.equal(assumption.requiresConfirmation, true);
});

test('missile Mach, launch range, travel range and aircraft release limit remain distinct', () => {
  const kh = findWeapon('Kh-31PD');
  assert.equal(kh.maxSpeedMach, 4);
  assert.equal(kh.launchRangeKm, 250);
  assert.equal(kh.guidanceTimeSeconds, 250);
  assert.equal(kh.seekerLockRangeKm, 100);
  assert.equal(kh.maxTravelRangeKm, null);
  assert.equal(kh.fieldStatus.maxTravelRangeKm, FIELD_STATUS.UNKNOWN);
  assert.ok(RUSSIAN_WEAPON_CATALOGUE.every(w => w.maxAircraftReleaseSpeedKmh === null && w.fieldStatus.maxAircraftReleaseSpeedKmh === FIELD_STATUS.UNKNOWN));
  assert.ok(RUSSIAN_WEAPON_CATALOGUE.every(w => !('maxSpeedKmh' in w)));
  assert.equal(findWeapon('Kh-59MK').guidanceTimeSeconds, 1000);
});

test('bomb missile-only fields are N/A while unlisted release speed is unknown', () => {
  const b = findWeapon('FAB-3000M-54');
  assert.equal(b.guidance.label, 'Unguided');
  assert.equal(b.guidance.seeker, 'NONE');
  for (const field of ['launchRangeKm', 'guidanceTimeSeconds', 'seekerLockRangeKm']) {
    assert.equal(b[field], null);
    assert.equal(b.fieldStatus[field], FIELD_STATUS.NOT_APPLICABLE);
  }
  assert.equal(b.fieldStatus.maxAircraftReleaseSpeedKmh, FIELD_STATUS.UNKNOWN);
  assert.equal(b.fieldStatus.maxSpeedMach, FIELD_STATUS.RELEASE_DEPENDENT);
  assert.equal(b.fieldStatus.maxTravelRangeKm, FIELD_STATUS.RELEASE_DEPENDENT);
  assert.equal(findWeapon('Kh-38MT').fieldStatus.seekerLockRangeKm, FIELD_STATUS.UNKNOWN);
  assert.equal(findWeapon('OFAB-100').role, 'FRAGMENTATION_HIGH_EXPLOSIVE_BOMB');
});

test('anti-radiation passive homing is separate from conventional SARH and anti-ship ARH', () => {
  const arms = RUSSIAN_WEAPON_CATALOGUE.filter(w => w.role === 'ANTI_RADIATION');
  assert.equal(arms.length, 5);
  assert.ok(arms.every(w => w.guidance.seeker === 'PASSIVE_RADAR' && !w.guidance.requiresCarrierIllumination));
  assert.equal(findWeapon('R-27ER').guidance.seeker, 'SEMI_ACTIVE_RADAR');
  assert.equal(findWeapon('R-27ER').guidance.requiresCarrierIllumination, true);
  assert.equal(findWeapon('R-77-1').guidance.seeker, 'ACTIVE_RADAR');
  assert.equal(findWeapon('R-77-1').guidance.requiresCarrierIllumination, false);
  assert.equal(findWeapon('Kh-59MK').role, 'ANTI_SHIP_CRUISE');
  assert.equal(findWeapon('Kh-59MK').guidance.seeker, 'ACTIVE_RADAR');
  assert.equal(findWeapon('Kh-29TD').guidance.label, 'TV');
});

test('Kh-58U seeker variants preserve individual Wiki band labels and common flight values', () => {
  const a = findWeapon('Kh-58U (A′)'), b = findWeapon('Kh-58U (B)'), c = findWeapon('Kh-58U (C)');
  assert.deepEqual([a.seekerBandLabels, b.seekerBandLabels, c.seekerBandLabels], [['I'], ['F'], ['D']]);
  for (const weapon of [a, b, c]) {
    assert.equal(weapon.maxSpeedMach, 3.5);
    assert.equal(weapon.launchRangeKm, 120);
    assert.equal(weapon.guidanceTimeSeconds, 240);
    assert.equal(weapon.massKg, 640);
    assert.equal(weapon.seekerLockRangeKm, 100);
  }
  assert.deepEqual(findWeapon('Kh-31PD').seekerBandLabels, ['D']);
  assert.deepEqual(findWeapon('Kh-58UShK').seekerBandLabels, ['D']);
  assert.deepEqual(findWeapon('Kh-59MK').seekerBandLabels, ['I']);
});

test('R-27 suffixes retain performance differences and IR aspect-dependent seeker ranges', () => {
  assert.equal(findWeapon('R-27R').maxSpeedMach, 3.5);
  assert.equal(findWeapon('R-27ER').maxSpeedMach, 5.8);
  assert.equal(findWeapon('R-27T').launchRangeKm, 50);
  assert.equal(findWeapon('R-27ET').launchRangeKm, 100);
  assert.equal(findWeapon('R-27T').massKg, 245.5);
  for (const id of ['R-27T', 'R-27ET']) {
    const weapon = findWeapon(id);
    assert.equal(weapon.seekerLockRangeKm, null);
    assert.equal(weapon.fieldStatus.seekerLockRangeKm, FIELD_STATUS.ASPECT_DEPENDENT);
    assert.deepEqual(weapon.seekerLockRangeByAspectKm, {rear: 18, allAspect: 4.8});
    assert.equal(weapon.guidance.seeker, 'INFRARED');
  }
});

test('mass, filler mass and TNT equivalent preserve independent values and bomb suffixes', () => {
  const m = findWeapon('Kh-29TD');
  assert.deepEqual([m.massKg, m.explosiveFillerMassKg, m.tntEquivalentKg], [686, 116.4, 186.2]);
  assert.deepEqual(['FAB-500M-46', 'FAB-500M-54', 'FAB-500M-62'].map(id => {
    const w = findWeapon(id); return [w.massKg, w.explosiveFillerMassKg, w.tntEquivalentKg];
  }), [[428, 325, 325], [478, 201, 201], [508.3, 213, 340.8]]);
  assert.deepEqual(['FAB-3000M-46', 'FAB-3000M-54'].map(id => {
    const w = findWeapon(id); return [w.massKg, w.explosiveFillerMassKg, w.tntEquivalentKg];
  }), [[2983, 1400, 1400], [3067, 1387, 2219.2]]);
});

test('reference values state user-guide provenance and are immutable', () => {
  assert.ok(RUSSIAN_WEAPON_CATALOGUE.every(w => w.provenance.independentlyVerified === false && /War Thunder/.test(w.provenance.basis)));
  assert.ok(Object.isFrozen(RUSSIAN_WEAPON_CATALOGUE));
  assert.throws(() => { findWeapon('Kh-31PD').guidance.seeker = 'SEMI_ACTIVE_RADAR'; }, TypeError);
  assert.throws(() => { findWeapon('Kh-58U (A′)').seekerBandLabels[0] = 'D'; }, TypeError);
});

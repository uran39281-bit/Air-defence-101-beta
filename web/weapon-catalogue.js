// Reference values transcribed from the user's Russian weapon catalogue.
// These are War Thunder game values, not independently verified real weapon
// specifications. Nothing in this module enables weapons or changes presets.
export const WEAPON_REFERENCE_PROVENANCE = Object.freeze({
  basis: 'User update guide: War Thunder weapon-panel game data',
  independentlyVerified: false,
  launchRangeMeaning: 'Listed Wiki Launch range; not guaranteed effective hit range',
  guidanceTimeMeaning: 'Listed missile guidance lifetime; not motor burn time',
  speedMeaning: 'Mach is retained without assuming atmospheric conditions',
  seekerBandMeaning: 'Displayed Wiki game-band label',
});

export const FIELD_STATUS = Object.freeze({
  LISTED: 'LISTED', UNKNOWN: 'UNKNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE', RELEASE_DEPENDENT: 'RELEASE_DEPENDENT',
  ASPECT_DEPENDENT: 'ASPECT_DEPENDENT',
});

const S = FIELD_STATUS;
const panel = {
  su30: 'War Thunder Su-30SM2 weapon panels',
  su39: 'War Thunder Su-39 weapon panels',
  mig27: 'War Thunder MiG-27K weapon panels',
  su27: 'War Thunder Su-27SM weapon panels',
  mig29: 'War Thunder MiG-29 (9-12) weapon panels',
  tu4: 'War Thunder Tu-4 weapon panels',
  su34: 'War Thunder Su-34 weapon panels',
  unspecified: 'War Thunder weapon panels; carrier panel not specified in guide',
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function guidance(label, seeker, components, requiresCarrierIllumination = false) {
  return {label, seeker, components, requiresCarrierIllumination};
}

const IR = guidance('IR', 'INFRARED', ['INFRARED']);
const TV = guidance('TV', 'TV', ['TV']);
const LASER = guidance('Laser', 'LASER', ['LASER']);
const ARH = guidance('ARH+IOG+DL', 'ACTIVE_RADAR', ['ACTIVE_RADAR', 'INERTIAL', 'DATALINK']);
const SARH = guidance('SARH+IOG+DL', 'SEMI_ACTIVE_RADAR', ['SEMI_ACTIVE_RADAR', 'INERTIAL', 'DATALINK'], true);
const ARM = guidance('Passive radar', 'PASSIVE_RADAR', ['PASSIVE_RADAR']);
const ARM_IOG = guidance('Passive radar + inertial', 'PASSIVE_RADAR', ['PASSIVE_RADAR', 'INERTIAL']);
const ARM_NOTE = 'Wiki ARM panels use SARH or SARH+IOG terminology; the guide specifies passive homing on the enemy radar emitter, without carrier illumination.';

function missile(id, role, guidanceData, speed, launchRange, lifetime, mass, filler, tnt, options = {}) {
  return {
    id, name: id, category: 'MISSILE', role,
    referenceOnly: true, gameplayEnabled: false,
    guidance: guidanceData,
    maxSpeedMach: speed,
    launchRangeKm: launchRange,
    maxTravelRangeKm: null,
    maxAircraftReleaseSpeedKmh: null,
    guidanceTimeSeconds: lifetime,
    maxG: options.maxG ?? null,
    massKg: mass, explosiveFillerMassKg: filler, tntEquivalentKg: tnt,
    seekerLockRangeKm: options.lockRange ?? null,
    seekerLockRangeByAspectKm: options.aspectRanges ?? null,
    seekerBandLabels: options.bands ?? null,
    fieldStatus: {
      maxSpeedMach: S.LISTED, launchRangeKm: S.LISTED,
      maxTravelRangeKm: S.UNKNOWN, maxAircraftReleaseSpeedKmh: S.UNKNOWN,
      guidanceTimeSeconds: S.LISTED,
      maxG: options.maxG == null ? S.UNKNOWN : S.LISTED,
      massKg: S.LISTED, explosiveFillerMassKg: S.LISTED, tntEquivalentKg: S.LISTED,
      seekerLockRangeKm: options.aspectRanges ? S.ASPECT_DEPENDENT : options.lockRange == null ? S.UNKNOWN : S.LISTED,
      seekerLockRangeByAspectKm: options.aspectRanges ? S.LISTED : S.NOT_APPLICABLE,
      seekerBandLabels: options.bands ? S.LISTED : S.UNKNOWN,
    },
    provenance: {...WEAPON_REFERENCE_PROVENANCE, reportedPanel: options.source ?? panel.unspecified},
    notes: options.notes ?? [],
  };
}

function bomb(id, mass, filler, tnt, options = {}) {
  return {
    id, name: id, category: 'UNGUIDED_BOMB',
    role: options.fragmentation ? 'FRAGMENTATION_HIGH_EXPLOSIVE_BOMB' : 'HIGH_EXPLOSIVE_BOMB',
    referenceOnly: true, gameplayEnabled: false,
    guidance: guidance('Unguided', 'NONE', []),
    maxSpeedMach: null, launchRangeKm: null, maxTravelRangeKm: null,
    maxAircraftReleaseSpeedKmh: null, guidanceTimeSeconds: null, maxG: null,
    massKg: mass, explosiveFillerMassKg: filler, tntEquivalentKg: tnt,
    seekerLockRangeKm: null, seekerLockRangeByAspectKm: null, seekerBandLabels: null,
    fieldStatus: {
      maxSpeedMach: S.RELEASE_DEPENDENT, launchRangeKm: S.NOT_APPLICABLE,
      maxTravelRangeKm: S.RELEASE_DEPENDENT,
      maxAircraftReleaseSpeedKmh: S.UNKNOWN,
      guidanceTimeSeconds: S.NOT_APPLICABLE, maxG: S.NOT_APPLICABLE,
      massKg: S.LISTED, explosiveFillerMassKg: S.LISTED, tntEquivalentKg: S.LISTED,
      seekerLockRangeKm: S.NOT_APPLICABLE, seekerLockRangeByAspectKm: S.NOT_APPLICABLE,
      seekerBandLabels: S.NOT_APPLICABLE,
    },
    provenance: {...WEAPON_REFERENCE_PROVENANCE, reportedPanel: options.source ?? panel.unspecified},
    notes: ['Flight speed and horizontal travel depend on release conditions.', ...(options.notes ?? [])],
  };
}

export const RUSSIAN_WEAPON_CATALOGUE = deepFreeze([
  missile('Kh-38MT', 'AIR_TO_GROUND', guidance('IR + inertial + GNSS', 'INFRARED', ['INFRARED', 'INERTIAL', 'GNSS']), 2.2, 70, 200, 520, 95, 152, {source: panel.su30}),
  missile('Kh-38ML', 'AIR_TO_GROUND', guidance('Laser + inertial + GNSS', 'LASER', ['LASER', 'INERTIAL', 'GNSS']), 2.2, 70, 200, 520, 95, 152, {source: panel.su30}),
  missile('Kh-31PD', 'ANTI_RADIATION', ARM_IOG, 4, 250, 250, 715, 85, 144.5, {source: panel.su30, lockRange: 100, bands: ['D'], notes: [ARM_NOTE]}),
  missile('Kh-29TD', 'AIR_TO_GROUND', TV, 1.8, 35, 70, 686, 116.4, 186.2, {notes: ['The guide retains the current panel label TV; the archived Wiki used TV+IR.']}),
  missile('Kh-58UShK', 'ANTI_RADIATION', ARM_IOG, 4, 245, 500, 650, 110, 176, {source: panel.su30, lockRange: 100, bands: ['D'], notes: [ARM_NOTE, 'The supplied spelling KH-58SHK is assumed to refer to Kh-58UShK; this suffix assumption remains unconfirmed.']}),
  missile('Kh-25ML', 'AIR_TO_GROUND', LASER, 2, 10, 45, 297, 93, 119, {source: panel.su39}),
  missile('Kh-29T', 'AIR_TO_GROUND', TV, 1.8, 13, 40, 670, 116.4, 186.2, {source: panel.mig27}),
  missile('Kh-29L', 'AIR_TO_GROUND', LASER, 1.8, 10, 40, 657, 116.4, 186.2),
  ...[['A′', 'I'], ['B', 'F'], ['C', 'D']].map(([variant, band]) =>
    missile(`Kh-58U (${variant})`, 'ANTI_RADIATION', ARM, 3.5, 120, 240, 640, 110, 176, {source: panel.su39, lockRange: 100, bands: [band], notes: [ARM_NOTE]})),
  missile('Kh-59MK', 'ANTI_SHIP_CRUISE', guidance('Active radar + inertial', 'ACTIVE_RADAR', ['ACTIVE_RADAR', 'INERTIAL']), .9, 120, 1000, 930, 119, 190.4, {source: panel.su30, lockRange: 15, bands: ['I'], notes: ['Kh-59MK retains its active radar guidance; it is not the TV-guided Kh-59M.']}),
  missile('R-77-1', 'AIR_TO_AIR', ARH, 4, 120, 120, 190, 9.7, 15.6, {source: panel.su30, maxG: 50, lockRange: 16, bands: ['I']}),
  missile('R-77', 'AIR_TO_AIR', ARH, 4, 80, 90, 175, 9.7, 15.6, {source: panel.su27, maxG: 50, lockRange: 16, bands: ['I']}),
  missile('R-27ER', 'AIR_TO_AIR', SARH, 5.8, 100, 60, 350, 15, 24, {source: panel.su27, maxG: 35, lockRange: 25, bands: ['I']}),
  missile('R-27R', 'AIR_TO_AIR', SARH, 3.5, 55, 60, 253, 15, 24, {source: panel.su27, maxG: 35, lockRange: 25, bands: ['I']}),
  missile('R-27T', 'AIR_TO_AIR', IR, 3.5, 50, 60, 245.5, 15, 24, {source: panel.su27, maxG: 35, aspectRanges: {rear: 18, allAspect: 4.8}}),
  missile('R-27ET', 'AIR_TO_AIR', IR, 5.8, 100, 60, 343, 15, 24, {source: panel.su27, maxG: 35, aspectRanges: {rear: 18, allAspect: 4.8}}),
  bomb('OFAB-100', 114, 38, 38, {fragmentation: true}),
  bomb('FAB-500M-46', 428, 325, 325, {source: panel.tu4}),
  bomb('FAB-500M-54', 478, 201, 201, {source: panel.mig29}),
  bomb('FAB-500M-62', 508.3, 213, 340.8),
  bomb('FAB-1500M-54', 1550, 675, 675),
  bomb('FAB-3000M-46', 2983, 1400, 1400, {source: panel.tu4, notes: ['Unguided bomb; not a UMPK glide weapon.']}),
  bomb('FAB-3000M-54', 3067, 1387, 2219.2, {source: panel.su34, notes: ['Unguided bomb; not a UMPK glide weapon.']}),
]);

export const WEAPON_VARIANT_NOTES = deepFreeze([
  {input: 'KH-58SHK', assumedWeaponId: 'Kh-58UShK', requiresConfirmation: true,
    note: 'Spelling is assumed to mean Kh-58UShK; the intended suffix is not confirmed.'},
  {input: 'FAB-500M', requiresVariant: true, variants: ['FAB-500M-46', 'FAB-500M-54', 'FAB-500M-62']},
  {input: 'FAB-3000M', requiresVariant: true, variants: ['FAB-3000M-46', 'FAB-3000M-54']},
  {input: 'R-27', requiresVariant: true, variants: ['R-27ER', 'R-27R', 'R-27T', 'R-27ET']},
  {input: 'Kh-58U', requiresVariant: true, variants: ['Kh-58U (A′)', 'Kh-58U (B)', 'Kh-58U (C)']},
]);

// Exact lookup deliberately avoids silently resolving ambiguous family names
// or the unconfirmed KH-58SHK spelling.
export function findWeapon(id) {
  return RUSSIAN_WEAPON_CATALOGUE.find(weapon => weapon.id === id) ?? null;
}

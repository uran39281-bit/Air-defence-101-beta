// Supplied equipment values; the beta-only defaults below are reviewable.
export const EQUIPMENT = Object.freeze({
  name: 'MIM-225 Horizon Shield', detection: 455, track: 315, lock: 310,
  tracks: 24, channels: 8, role: 'Strategic defense',
  nctr: ['Su-27','MiG-29','MiG-25','Tu-160'],
  missile: {name:'MIM-225A',range:305,guidance:'ACTIVE_RADAR',maneuver:4,explosive:140,warhead:'blast-fragmentation'}
});
export const BETA = Object.freeze({
  scanRating:3.00, slowSweep:8, fastSweep:2, outerRangeFactor:1.25,
  trackAcquire:2, lockAcquire:1.8, lockTolerance:2, launchQuality:.48,
  coastTime:6, trackTimeout:18, contactTimeout:34, uncertaintyPerSecond:.025,
  radarSwitch:2, irstSwitch:.5, irstRange:140, irstInterval:1.5, irstCapacity:8,
  irstAcquire:1.5, irWeatherFactor:.9,
  roundsPerLauncher:4, reserveRounds:24, reloadSeconds:18, launchCooldown:1,
  missileSpeed:1.7, initialMissileSpeed:.3, acceleration:.6, missileLifetime:240,
  seekerRange:38, seekerFov:70, seekerAcquire:.8, searchTimeout:14,
  guidanceLoss:4, reacquireTime:4, irSeekerRange:24, irFov:50,
  turnBaseDegrees:4, turnDegreesPerRating:2.8, fuzeKm:.16,
  damageScale:.020, targetHealth:100, scenarioSeconds:720,
  spawnInterval:36, maxAircraft:12, maxPlayerHits:4,
  idTypeSeconds:12, idAllegianceSeconds:20, idEvidenceRange:220,
  hostileMissilesEnabled:true, missileDetectionFactor:.6, missileClassificationSweeps:2,
  startAircraft:6, seed:225101
});
export function sweepInterval(rating=BETA.scanRating){return BETA.slowSweep-(Math.max(1,Math.min(6,rating))-1)/5*(BETA.slowSweep-BETA.fastSweep);}
export const ICONS = Object.freeze({player:'player_missile.png',hostile:'hostile_jet.png',friendly:'friendly_jet.png',hostileMissile:'hostile_missile.png',hostileUnknown:'hostile_no_ID.png',friendlyUnknown:'friendlty_no_ID.png',unknownTrack:'unknown_track.png',unknown:'Unknown_untracked_target.png'});

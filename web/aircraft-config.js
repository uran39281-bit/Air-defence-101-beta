// Adopted editable profiles from the user's aircraft/RWR update. These are game
// caps and tiers, not verified specifications for real receivers or aircraft.
export const AIRCRAFT = Object.freeze({
  'Su-27': {name:'Su-27', role:'Air-superiority fighter', mission:'BOMB STRIKE',
    maxSpeed:2400, lowSpeed:1400, referenceAltitude:12000, ceiling:16000,
    structuralG:11, commandedG:9, maneuver:8, stealth:0, signature:1,
    presets:['WP-1','WP-0'], bombs:4, rwr:'RWR-S27', countermeasures:96,
    aggression:.55, source:{variant:'Su-27',mode:'upgraded realistic',basis:'Rounded values adopted from update guide'}},
  'MiG-29': {name:'MiG-29', role:'Frontline fighter', mission:'BOMB STRIKE',
    maxSpeed:2350, lowSpeed:1450, referenceAltitude:14000, ceiling:16000,
    structuralG:13, commandedG:9, maneuver:8.5, stealth:0, signature:.9,
    presets:['WP-1','WP-0'], bombs:2, rwr:'RWR-M29', countermeasures:60,
    aggression:.55, source:{variant:'MiG-29 (9-13)',mode:'upgraded realistic',basis:'Rounded values adopted from update guide'}},
  'MiG-25': {name:'MiG-25', role:'High-altitude interceptor', mission:'INTRUSION / DIVERSION',
    maxSpeed:2940, lowSpeed:1200, referenceAltitude:18000, ceiling:25000,
    structuralG:7, commandedG:5, maneuver:3, stealth:0, signature:1.15,
    presets:['WP-0'], bombs:0, rwr:'RWR-M25', countermeasures:64,
    aggression:.5, source:{variant:'MiG-25PD',mode:'upgraded realistic',basis:'Rounded values adopted from update guide'}},
  'Tu-160': {name:'Tu-160', role:'Strategic bomber / missile carrier', mission:'BOMB STRIKE',
    maxSpeed:2200, lowSpeed:1000, referenceAltitude:12000, ceiling:16000,
    structuralG:3, commandedG:2, maneuver:1.5, stealth:0, signature:1.4,
    presets:['WP-1','WP-0'], bombs:8, rwr:'RWR-T160', countermeasures:128,
    aggression:.35, source:{variant:null,mode:null,basis:'Entire numerical profile is provisional gameplay data'}}
});

const COMMON={horizontal:360,vertical:150,sensitivity:.13,missChance:.03,
  ambiguousChance:.03,waveforms:['SEARCH','PULSE_DOPPLER','FIRE_CONTROL','ILLUMINATION','ACTIVE_SEEKER']};
export const RWR_TIERS = Object.freeze({
  0:{...COMMON,generation:0,bands:[],waveforms:[],bearingError:180,delay:0,memory:0,capacity:0,search:false,fireControl:false,illumination:false,seeker:false,library:[]},
  1:{...COMMON,generation:1,bands:['H','I','J'],sectors:4,bearingError:45,delay:1.2,memory:6,capacity:4,search:true,fireControl:true,illumination:false,seeker:false,library:['BETA_SEARCH','BETA_FIRE_CONTROL','BETA_ILLUMINATION']},
  2:{...COMMON,generation:2,bands:['G','H','I'],bearingError:15,delay:.7,memory:8,capacity:8,search:true,fireControl:true,illumination:true,seeker:true,library:['BETA_SEARCH','BETA_FIRE_CONTROL','BETA_ILLUMINATION','BETA_SEEKER']},
  3:{...COMMON,generation:3,bands:['C','D','E','F','G','H','I','J'],bearingError:5,delay:.3,memory:10,capacity:16,sensitivity:.08,search:true,fireControl:true,illumination:true,seeker:true,library:['BETA_SEARCH','BETA_FIRE_CONTROL','BETA_ILLUMINATION','BETA_SEEKER']}
});
export const RWR_PROFILES = Object.freeze({
  'RWR-S27':{...RWR_TIERS[2],id:'RWR-S27'},
  'RWR-M29':{...RWR_TIERS[2],id:'RWR-M29'},
  'RWR-M25':{...RWR_TIERS[1],id:'RWR-M25'},
  'RWR-T160':{...RWR_TIERS[2],id:'RWR-T160'}
});
export const AI_DEFAULTS = Object.freeze({
  skill:.4, aggression:.55, reactionMin:2,reactionMax:4,
  emergencyMin:1,emergencyMax:2,missileMemory:12,abortHealth:35,
  stateHold:2,safeClear:6,failedApproaches:2,decisionInterval:.25,
  sensorInterval:.2,visualRange:8,visualFov:130,visualVertical:110,
  visualAcquire:1.2,visualWeather:.85,nightPenalty:1,maws:false,
  cmBurst:3,cmCooldown:1.5,cmLifetime:3,cmReserve:.1,
  decoyResistance:.78,decoyAcquire:.25,decoyUpdate:.25,
  initialCruise:.8,acceleration:.006,deceleration:.012,turnEnergyLoss:.0014,
  minimumSpeed:.09,safeAltitude:.6,climbRate:.035,
  riskAbortSeconds:32,emissionBand:'I',searchStrength:8,
  fireControlStrength:6,seekerStrength:2,searchBeam:14,
  fireControlBeam:12,bombAltitude:2.5,attackEntry:18,
  exitRadius:600,intrusionWaypointRadius:8,
  bombGravity:.00981,bombReleaseRadius:.65,bombHeadingTolerance:8,
  bombHitRadius:.42,bombReleaseCooldown:.65,bombDamageHits:1,
  bombExplosive:250,bombDefinition:'BETA-BOMB-250',bombSalvo:1,
  terrainHeight:0,notchSupported:false,notchQuality:.75,
  heatReduction:.65,heatEnergyPenalty:.2
});
export const WEAPON_PRESETS = Object.freeze({
  'WP-0':{id:'WP-0',category:'NONE',weapon:null,cooldown:0},
  'WP-1':{id:'WP-1',category:'UNGUIDED_BOMB',weapon:'BETA-BOMB-250',cooldown:.65},
  'WP-2':{id:'WP-2',category:'UNGUIDED_ROCKET',enabled:false},
  'WP-3':{id:'WP-3',category:'AIR_TO_GROUND_MISSILE',enabled:false}
});

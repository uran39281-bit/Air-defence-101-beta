# AIR DEFENSE 101 — fresh beta rebuild

Offline Android radar-defense game rebuilt from the [Google Doc guide](https://docs.google.com/document/d/170pFAgDHbSvsvS7WbFxBIpvjbH0DjT8GjzXJBw4zvy4/edit). The full source Google Doc is excluded from this public backup. The original supplied artwork is preserved in `reference-assets/`; optimized copies are in `web/assets/`.

[Download the signed beta APK](releases/Air-Defense-101-Beta-v0.1.0.apk)

Requires Android 8 or later and an updated Android System WebView. Landscape interface. No network permission, ads, account, or external dependency at runtime. Package ID: `com.prime.airdefense.beta`.

![Playable radar interface](docs/game-preview.png)

## Play

Start the beta exercise. Wait for two radar sweeps to build TWS tracks. Select a contact on the radar, in the TWS list, or with NEXT TARGET. Select a ready launcher, then FIRE. MIM-225A is active radar homing and needs a usable track within its nominal envelope; it does **not** need a hard lock. Use time acceleration for long-range missile flights. Two missiles may be needed for a glancing hit. Keep checking the battle log and channel count.

Tap the selected launcher again to reload early; empty launchers reload automatically. The exercise lasts 12 simulation minutes, or until four aircraft attacks hit the battery. It starts with six aircraft and adds attackers over time. Only Su-27, MiG-29, Su-25, Tu-95, and Tu-160 spawn. No hostile missiles or friendly aircraft spawn.

## Implemented

- Separate hidden simulation and sensor estimates. Detections update at sweep revisits; untracked contacts hold their last measurement. Tracks estimate velocity from measurement history, predict between sweeps, coast, become STALE, and expire.
- Automatic tracking retains usable existing tracks and fills free slots by measured range, up to the supplied 24 slots. Selecting a contact has no tracking, recognition, or locking side effect.
- Timed radar lock acquisition; locks require usable tracks and sufficient range quality. Scanning continues while locked. Selection uses corner brackets, tracks use dotted circles, radar locks use solid circles.
- Active MIDCOURSE, SEARCHING, and SEEKER LOCK states, bounded turning, acceleration, flight lifetime, seeker field of view, acquisition dwell, reacquisition, and early-search fallback.
- Eight shared guidance channels. Overflow transfers the oldest supported missile's channel and logs the consequence. The UI previews the transfer before firing. Active missiles release channels on seeker activation.
- Configurable semi-active illumination-loss/coast/self-destruct behavior and constrained illumination retargeting; tested using controlled configurations. Independent passive IRST cues and IR seeker flight without channels; tested using controlled configurations. Only the supplied MIM-225A is selectable in the beta.
- RADAR and IRST switching delays, AUTO TRACK, RESET, lock/unlock, four launchers, loaded/reserve inventory, reloads, pause, time acceleration, battle log, and exercise result/restart.
- Separate NCTR/type and allegiance evidence. Unknown contacts remain unknown until sufficient evidence accumulates. NCTR alone does not establish hostility. This flat beta uses synthetic exercise-intelligence evidence, rather than absent IFF replies, for hostility confirmation.
- Visible missile travel, segment-based proximity checks, distance-dependent blast damage, partial damage, kills, aircraft retreat, delayed warning-driven evasion, and battery attacks.
- Exact supplied icon paths, including `friendlty_no_ID.png`. Original transparency/aspect ratios remain intact. Three supplied icons have opaque black backgrounds; runtime screen compositing avoids black squares while preserving their artwork.

## Supplied equipment values

| Battery | Value |
|---|---|
| Name | MIM-225 Horizon Shield |
| Detection / track / lock | 455 / 315 / 310 km |
| TWS capacity / guidance channels | 24 / 8 |
| NCTR database | All five beta aircraft types |
| Missile | MIM-225A, active radar homing |
| Nominal range | 305 km |
| Maneuverability | 4.00 / 10.00 |
| Warhead | 140 kg explosive mass, blast-fragmentation |

## Provisional defaults and current limits

All defaults live in [web/config.js](web/config.js) and can be changed without changing simulation logic. They are beta balancing values, not final equipment specifications.

| Parameter | Provisional value |
|---|---|
| Scan rating / sweep mapping | 3.00; linear 1.00 → 8 s, 6.00 → 2 s; current 5.6 s |
| Range outer cutoff | 1.25× each effective radar range; gradual falloff beyond effective range |
| Lock acquisition / loss tolerance | 1.8 s / 2 s |
| Track coast / expiration / contact fade | 6 / 18 / 34 s |
| Usable launch quality | 0.48 |
| Radar / IRST switching | 2 / 0.5 s |
| IRST range / update / capacity | 140 km / 1.5 s / 8; uniform weather factor 0.9 |
| Launcher / reserve / reload | 4 per launcher / 24 total reserve / 18 s |
| Missile maximum speed / acceleration / lifetime | 1.7 km/s / 0.6 km/s² / 240 s |
| Active seeker range / full FOV / acquisition | 38 km / 70° / 0.8 s |
| Search / reacquisition / illumination loss | 14 / 4 / 4 s |
| IR seeker range / FOV | 24 km / 50° |
| Turn conversion | 4 + 2.8×maneuverability degrees/s |
| Proximity radius / damage scale | 0.16 km / 0.020 |
| Attacker warning reaction / evasion probability | 4 s / 0.18, only following modeled detectable emissions |
| Starting contacts / exercise duration | 6 / 720 simulation seconds |

Current limits: flat 2.5D exercise airspace with altitude, no terrain masking or spatial cloud model; IR contrast/aspect behavior is simplified to a weather-adjusted range gate; recognition is synthetic exercise evidence; one battery fire-control lock; no tech tree, economy, story missions, sound, hostile missile spawning, or persistent campaign progress. Damage currently implements the supplied blast-fragmentation warhead; other warhead types are future extensions. Seeker acquisition is a simplified angular/range model. Those limits are deliberately visible rather than presented as completed real-world modeling.

## Development and verification

The dependency-free game engine is JavaScript and Canvas. Android hosts the same assets in a hardware-accelerated WebView on a local secure origin with external navigation blocked. The Android wrapper uses platform APIs and no Gradle dependency downloads.

```sh
npm test
npm run serve
# Open http://localhost:8080
```

20 deterministic simulation checks cover track capacity, measurement prediction/correction, launch/lock prerequisites, active seeker states, both channel overflow cases, radar OFF, RESET, IR independence, track expiration, inventory, damage, moving-target interception, scan intervals, and icon paths.

`scripts/qa-browser.mjs` adds real UI interaction checks and desktop/phone-sized screenshots. Install Playwright separately to run it; `CHROME_PATH` may select a local Chromium executable. Browser validation covers menu/guide, target selection, fire, lock/unlock, AUTO TRACK, IRST, RADAR OFF, RESET, and all visible image paths. APK manifest and v2/v3 signatures are verified by the build script. A physical Android installation has not been tested in this environment.

### Build Android

Install JDK 17 and Android SDK platform 35 / build-tools 35.0.0, then:

```sh
export ANDROID_SDK_ROOT=/path/to/android-sdk
export AIR_DEFENSE_KEYSTORE=/private/path/to/beta.keystore
bash scripts/build-apk.sh
```

The output is `dist/Air-Defense-101-Beta-v0.1.0.apk`. This beta uses a development signing identity (`beta` alias; development password `android`). Keep the key out of this public repository and reuse it for locally built updates. Increase versionCode/versionName for each update. The GitHub Actions workflow also tests and builds, but creates an ephemeral development key unless configured separately; its APK may require uninstalling a differently signed installation. The checked-in downloadable APK uses the retained local beta key.

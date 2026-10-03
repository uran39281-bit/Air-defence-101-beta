#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
TOOLS="$SDK/build-tools/35.0.0"
ANDROID_JAR="$SDK/platforms/android-35/android.jar"
OUT=build
mkdir -p "$OUT/classes" dist
rm -rf "$OUT/classes" "$OUT/assets"
mkdir -p "$OUT/classes"
cp -R web "$OUT/assets"
"$TOOLS/aapt2" compile --dir android/res -o "$OUT/resources.zip"
"$TOOLS/aapt2" link -o "$OUT/unsigned.apk" --manifest android/AndroidManifest.xml -I "$ANDROID_JAR" --min-sdk-version 26 --target-sdk-version 35 "$OUT/resources.zip" -A "$OUT/assets"
javac --release 8 -classpath "$ANDROID_JAR" -d "$OUT/classes" android/src/com/prime/airdefense/beta/MainActivity.java
"$TOOLS/d8" --min-api 26 --lib "$ANDROID_JAR" --output "$OUT" "$OUT/classes/com/prime/airdefense/beta/"*.class
(cd "$OUT" && zip -q unsigned.apk classes.dex)
"$TOOLS/zipalign" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
KEY="${AIR_DEFENSE_KEYSTORE:-$HOME/.air-defense-beta/beta.keystore}"
mkdir -p "$(dirname "$KEY")"
if [[ ! -f "$KEY" ]]; then
  keytool -genkeypair -noprompt -keystore "$KEY" -storepass android -keypass android -alias beta -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=AIR DEFENSE Beta Development"
fi
"$TOOLS/apksigner" sign --ks "$KEY" --ks-key-alias beta --ks-pass pass:android --key-pass pass:android --out dist/Air-Defense-101-Beta-v0.2.1.apk "$OUT/aligned.apk"
"$TOOLS/apksigner" verify --verbose dist/Air-Defense-101-Beta-v0.2.1.apk
"$TOOLS/aapt" dump badging dist/Air-Defense-101-Beta-v0.2.1.apk

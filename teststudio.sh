#!/bin/bash
# ==============================================================================
#                 FEDERaiDE Android Studio Local Emulator Tester
# ==============================================================================
set -e

echo "======================================================================"
echo "          FEDERaiDE Android Studio Local Simulator Tester             "
echo "======================================================================"

# 1. Locate Android SDK
if [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
elif [ -d "$HOME/Android/Sdk" ]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
elif [ -n "$ANDROID_SDK_ROOT" ]; then
    export ANDROID_HOME="$ANDROID_SDK_ROOT"
else
    echo "[!] Error: ANDROID_HOME could not be located automatically."
    exit 1
fi

# 2. Locate valid Java (Checking Android Studio JBR first)
if [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
elif [ -d "/Applications/Android Studio.app/Contents/jre/Contents/Home" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jre/Contents/Home"
else
    export JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || /usr/libexec/java_home 2>/dev/null || echo "")
fi

if [ -z "$JAVA_HOME" ] || [ ! -d "$JAVA_HOME" ]; then
    echo "[!] Error: Could not find a valid JDK installation."
    exit 1
fi

export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"

echo "[*] Using ANDROID_HOME: $ANDROID_HOME"
echo "[*] Using JAVA_HOME:    $JAVA_HOME"

# 3. Check for running Android Emulator or connected device via ADB
echo "[*] Checking for connected Android devices or emulators..."
if ! command -v adb &> /dev/null; then
    echo "[!] Error: 'adb' tool not found in PATH."
    exit 1
fi

RUNNING_DEVICES=$(adb devices | grep -w "device" || true)
if [ -z "$RUNNING_DEVICES" ]; then
    echo "[*] No active emulator/device detected. Searching for available AVDs..."
    if command -v emulator &> /dev/null; then
        AVAILABLE_AVDS=$(emulator -list-avds || true)
        if [ -n "$AVAILABLE_AVDS" ]; then
            FIRST_AVD=$(echo "$AVAILABLE_AVDS" | head -n 1)
            echo "[*] Booting virtual device: $FIRST_AVD..."
            emulator -avd "$FIRST_AVD" -no-snapshot-load &
            echo "[*] Waiting for emulator to boot up..."
            adb wait-for-device
            
            while [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
                sleep 2
            done
            echo "[*] Emulator successfully booted and ready."
        else
            echo "[!] No Android Virtual Devices (AVDs) found."
            exit 1
        fi
    else
        echo "[!] 'emulator' binary not found."
        exit 1
    fi
else
    echo "[*] Active device/emulator found."
fi

# 4. Create an Isolated Temporary Sandbox (Zero Git Pollution)
if [ -f "app.json" ] && [ -f "package.json" ]; then
    REPO_ROOT="$(pwd)"
    SANDBOX_PARENT="$(mktemp -d)"
    SANDBOX_DIR="$SANDBOX_PARENT/federaide_sandbox"
    echo "[*] Creating clean temporary build sandbox at: $SANDBOX_DIR"
    mkdir -p "$SANDBOX_DIR"
    
    rsync -av --exclude 'android' --exclude 'node_modules' --exclude '.git' ./ "$SANDBOX_DIR/"
    cd "$SANDBOX_DIR"
else
    echo "[!] Error: Please run this script from inside the 'FederaideMobile/' directory."
    exit 1
fi

trap "rm -rf '$SANDBOX_PARENT'; echo '[*] Cleaned up temporary sandbox directory.'" EXIT

# 5. Install Node modules in sandbox
echo "[*] Installing Node dependencies in sandbox..."
npm install --legacy-peer-deps

# 6. Run Expo Prebuild to generate clean native Android folder
echo "[*] Running expo prebuild for android..."
npx expo prebuild --platform android --clean

# 6.1 Copy repo's native Android, assets, modules, and plugins folders into sandbox
for dir in android assets modules plugins; do
    if [ -d "$REPO_ROOT/$dir" ]; then
        echo "[*] Syncing repo's $dir directory into sandbox..."
        rsync -av "$REPO_ROOT/$dir/" "$SANDBOX_DIR/$dir/"
    fi
done

# Ensure assets (bootstrap, install scripts, python bridge) are present in Android assets
if [ -d "$REPO_ROOT/assets" ]; then
    mkdir -p "$SANDBOX_DIR/android/app/src/main/assets"
    rsync -av "$REPO_ROOT/assets/" "$SANDBOX_DIR/android/app/src/main/assets/"
fi

# 7. Bypass Java connection bugs for Gradle wrapper
echo "[*] Ensuring Gradle distribution is cached locally (bypassing Java network issues)..."
cd android
# Extract the original URL
GRADLE_URL=$(grep "distributionUrl" gradle/wrapper/gradle-wrapper.properties | cut -d= -f2- | sed 's/\\//g' | tr -d '\r')
GRADLE_ZIP=$(basename "$GRADLE_URL")
LOCAL_ZIP_PATH="/tmp/$GRADLE_ZIP"

if [ ! -f "$LOCAL_ZIP_PATH" ]; then
    echo "    -> Downloading $GRADLE_ZIP via curl..."
    curl -L -o "$LOCAL_ZIP_PATH" "$GRADLE_URL"
else
    echo "    -> Using cached $LOCAL_ZIP_PATH"
fi

# Update properties to point to the locally downloaded file
sed -i.bak "s|^distributionUrl=.*|distributionUrl=file\\://$LOCAL_ZIP_PATH|" gradle/wrapper/gradle-wrapper.properties
cd ..

# 8. Configure local.properties for Gradle
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# Force Java to prefer IPv4 (fixes many other gradle sync connection issues on Macs)
export GRADLE_OPTS="-Djava.net.preferIPv4Stack=true -Xmx2560m"

# 9. Build Release APK
echo "[*] Compiling APK via Gradle (assembleRelease)..."
cd android
./gradlew assembleRelease --no-daemon
cd ..

APK_PATH="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
    echo "[!] Build failed: app-release.apk could not be found."
    exit 1
fi
echo "[+] APK successfully built at: $SANDBOX_DIR/$APK_PATH"

# 10. Install and Launch on Emulator
echo "[*] Wiping previous application data for a fresh install..."
adb shell pm clear in.rocklab.federaide || true

echo "[*] Installing APK onto emulator..."
adb install -r "$APK_PATH"

echo "[*] Launching app package 'in.rocklab.federaide'..."
adb shell monkey -p in.rocklab.federaide -c android.intent.category.LAUNCHER 1

echo "======================================================================"
echo " 🎉 App is running on your Android simulator!"
echo " Streaming live Logcat output below (Press Ctrl+C to exit)..."
echo "======================================================================"

adb logcat -c
adb logcat -s "ReactNative" "ReactNativeJS" "TermuxNative" "System.out" "AndroidRuntime"
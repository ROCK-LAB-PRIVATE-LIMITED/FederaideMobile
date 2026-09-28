# 1. Ensure Android SDK & Java are in PATH
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || echo "/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home")
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

# 2. Clean and prebuild
rm -rf android
npx expo prebuild --platform android --clean

# Verify permissions in generated AndroidManifest.xml
echo "--- Generated Permissions in Manifest ---"
grep "uses-permission" android/app/src/main/AndroidManifest.xml || echo "No permissions declared."
echo "-----------------------------------------"


# Verify it got injected!
grep -n "TermuxNativePackage" android/app/src/main/java/in/rocklab/federaide/MainApplication.kt

# 4. Write local.properties and build Release APK
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
cd android
./gradlew assembleRelease --no-daemon
cd ..

# 5. Install & Run on OnePlus
adb logcat -c
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell monkey -p in.rocklab.federaide -c android.intent.category.LAUNCHER 1
#!/usr/bin/env bash
set -e

# Automatically set Java & Android SDK paths
export JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || echo "/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home")
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

echo "🚀 Starting local Android APK build..."
eas build --platform android --profile preview --local

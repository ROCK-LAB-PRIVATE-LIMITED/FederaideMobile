/*
 * FEDERaiDE Mobile is an android app that runs the federaide harness with appropriate UI.
 * Copyright (C) 2026-2027  ROCK LAB PRIVATE LIMITED
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

package com.federaide.terminal

import android.content.Context
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.io.*
import java.nio.charset.StandardCharsets

class TermuxNativeModule : Module() {
    private var mPythonProcess: Process? = null
    private var mPythonStdin: BufferedWriter? = null

    private val context: Context
        get() = appContext.reactContext ?: throw IllegalStateException("React context is null")

    override fun definition() = ModuleDefinition {
        Name("TermuxNative")

        Events("onTermuxLog", "onPythonMessage")

        AsyncFunction("getLastCrashLog") { promise: Promise ->
            try {
                val crashFile = File(context.filesDir, "last_crash.txt")
                if (crashFile.exists()) {
                    promise.resolve(crashFile.readText())
                } else {
                    promise.resolve(null)
                }
            } catch (e: Exception) {
                promise.resolve(null)
            }
        }

        AsyncFunction("setupEnvironment") { promise: Promise ->
            Thread {
                try {
                    val filesDir = context.filesDir
                    val usrDir = File(filesDir, "usr")
                    val homeDir = File(filesDir, "home")
                    homeDir.mkdirs()

                    if (!TermuxInstaller.isInstalled(context)) {
                        this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to "[INIT] Initializing Termux rootfs bootstrap..."))
                        TermuxInstaller.installEnvironment(context, object : TermuxInstaller.LogCallback {
                            override fun onLog(message: String) {
                                this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to message))
                            }
                        })
                    } else {
                        this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to "[INIT] Existing Termux rootfs verified. Ensuring permissions..."))
                        
                        // Copy real GPG keys from share/termux-keyring into etc/apt/trusted.gpg.d safely
                        try {
                            val gpgShareDir = File(usrDir, "share/termux-keyring")
                            val gpgAptDir = File(usrDir, "etc/apt/trusted.gpg.d")
                            gpgAptDir.mkdirs()
                            if (gpgShareDir.exists()) {
                                gpgShareDir.listFiles()?.forEach { keyFile ->
                                    if (keyFile.isFile && keyFile.name.endsWith(".gpg")) {
                                        val destKey = File(gpgAptDir, keyFile.name)
                                        try { destKey.delete() } catch (ignored: Exception) {}
                                        try { keyFile.copyTo(destKey, overwrite = true) } catch (ignored: Exception) {}
                                    }
                                }
                            }
                        } catch (ignored: Exception) {}

                        TermuxInstaller.fixPermissionsRecursive(filesDir)
                    }

                    // Unconditionally copy install.sh and mobile_bridge_termux.py into homeDir
                    val scriptFile = File(homeDir, "mobile_bridge_termux.py")
                    val installFile = File(homeDir, "install.sh")
                    copyAssetFile("mobile_bridge_termux.py", scriptFile)
                    copyAssetFile("install.sh", installFile)
                    try { android.system.Os.chmod(installFile.absolutePath, 493) /* 0755 */ } catch (e: Exception) {}

                    promise.resolve(true)
                } catch (e: Exception) {
                    this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to "[STDERR] Setup Failed: ${e.message}"))
                    promise.reject("SETUP_ERROR", e.message ?: "Setup failed", e)
                }
            }.start()
        }

        AsyncFunction("executeCommand") { command: String, args: List<String>?, stdin: String?, promise: Promise ->
            Thread {
                try {
                    val filesDir = context.filesDir
                    val usrDir = File(filesDir, "usr")
                    val homeDir = File(filesDir, "home")
                    val bashBin = File(usrDir, "bin/bash")
                    val linkerBin = File("/system/bin/linker64")

                    val commandLine = if (command == "bash" && args != null && args.isNotEmpty() && args[0] == "-c") {
                        args.subList(1, args.size).joinToString(" ")
                    } else if (args != null && args.isNotEmpty()) {
                        "$command " + args.joinToString(" ")
                    } else {
                        command
                    }

                    // Direct invocation via system linker64 (Termux Google Play implementation)
                    val cmdList = mutableListOf(
                        linkerBin.absolutePath,
                        bashBin.absolutePath,
                        "-c",
                        commandLine
                    )

                    this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to "[EXEC] $commandLine"))

                    val pb = ProcessBuilder(cmdList)
                    pb.directory(homeDir)
                    pb.environment().putAll(buildEnvironment(usrDir, homeDir))
                    pb.redirectErrorStream(true)

                    val process = pb.start()

                    if (!stdin.isNullOrEmpty()) {
                        try {
                            val writer = BufferedWriter(OutputStreamWriter(process.outputStream, StandardCharsets.UTF_8))
                            writer.write(stdin)
                            writer.flush()
                            writer.close()
                        } catch (ignored: Exception) {}
                    }

                    val stdoutStream = ByteArrayOutputStream()
                    val reader = BufferedReader(InputStreamReader(process.inputStream, StandardCharsets.UTF_8))
                    var line: String?
                    val logFile = File(filesDir, "install_debug.log")
                    val logWriter = FileWriter(logFile, true)

                    while (reader.readLine().also { line = it } != null) {
                        Log.i("TermuxLog", line!!)
                        logWriter.write(line + "\n")
                        logWriter.flush()
                        this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to line!!))
                        stdoutStream.write((line + "\n").toByteArray(StandardCharsets.UTF_8))
                    }
                    logWriter.close()

                    val exitCode = process.waitFor()
                    val output = String(stdoutStream.toByteArray(), StandardCharsets.UTF_8)

                    promise.resolve(mapOf(
                        "exitCode" to exitCode,
                        "output" to output
                    ))
                } catch (e: Exception) {
                    this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to "[STDERR] Exec Error: ${e.message}"))
                    promise.reject("EXEC_FAILED", e.message ?: "Execution failed", e)
                }
            }.start()
        }

        AsyncFunction("startPythonBridge") { promise: Promise ->
            Thread {
                try {
                    mPythonProcess?.destroy()

                    val filesDir = context.filesDir
                    val usrDir = File(filesDir, "usr")
                    val homeDir = File(filesDir, "home")
                    val linkerBin = File("/system/bin/linker64")
                    val scriptFile = File(homeDir, "mobile_bridge_termux.py")
                    val installFile = File(homeDir, "install.sh")


                    // Ensure python3 symlink exists if python3.13 was installed
                    val python3Bin = File(usrDir, "bin/python3")
                    val python313Bin = File(usrDir, "bin/python3.13")
                    if (!python3Bin.exists() && python313Bin.exists()) {
                        try { android.system.Os.symlink("python3.13", python3Bin.absolutePath) } catch (ignored: Exception) {}
                    }

                    // Dynamically resolve python binary (tool venv -> python3.13 -> python3)
                    val uvPython = File(homeDir, ".local/share/uv/tools/federaide/bin/python")
                    val pythonBin = when {
                        uvPython.exists() -> uvPython
                        python313Bin.exists() -> python313Bin
                        else -> python3Bin
                    }

                    copyAssetFile("mobile_bridge_termux.py", scriptFile)
                    copyAssetFile("install.sh", installFile)
                    try { android.system.Os.chmod(installFile.absolutePath, 493) } catch (e: Exception) {}

                    // Sync local development Python overlay into site-packages/federate/
                    try {
                        val sitePackagesDir = File(homeDir, ".local/share/uv/tools/federaide/lib/python3.13/site-packages/federate")
                        sitePackagesDir.mkdirs()
                        val assetList = context.assets.list("federate") ?: emptyArray()
                        for (asset in assetList) {
                            val targetFile = File(sitePackagesDir, asset)
                            context.assets.open("federate/$asset").use { input ->
                                FileOutputStream(targetFile).use { output ->
                                    input.copyTo(output)
                                }
                            }
                        }
                        if (assetList.isNotEmpty()) {
                            this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to "[BRIDGE] Overlaid ${assetList.size} local development module files onto federate site-packages."))
                        }
                    } catch (e: Exception) {
                        Log.w("TermuxNative", "Could not sync local federate assets: ${e.message}")
                    }

                    val resolvedPython = if (pythonBin.exists()) pythonBin.canonicalFile else pythonBin

                    val cmdList = mutableListOf(
                        linkerBin.absolutePath,
                        resolvedPython.absolutePath,
                        "-u",
                        scriptFile.absolutePath
                    )
                    val pb = ProcessBuilder(cmdList)
                    pb.directory(homeDir)
                    pb.environment().putAll(buildEnvironment(usrDir, homeDir))
                    pb.redirectErrorStream(false)

                    this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to "[BRIDGE] Spawning Python stdio IPC bridge..."))
                    mPythonProcess = pb.start()
                    mPythonStdin = BufferedWriter(OutputStreamWriter(mPythonProcess!!.outputStream, StandardCharsets.UTF_8))

                    Thread {
                        try {
                            BufferedReader(InputStreamReader(mPythonProcess!!.inputStream, StandardCharsets.UTF_8)).use { reader ->
                                var line: String?
                                while (reader.readLine().also { line = it } != null) {
                                    if (line!!.trim().isNotEmpty()) {
                                        this@TermuxNativeModule.sendEvent("onPythonMessage", mapOf("raw" to line!!))
                                    }
                                }
                            }
                        } catch (ignored: Exception) {}
                    }.start()

                    Thread {
                        try {
                            BufferedReader(InputStreamReader(mPythonProcess!!.errorStream, StandardCharsets.UTF_8)).use { reader ->
                                var errLine: String?
                                while (reader.readLine().also { errLine = it } != null) {
                                    Log.e("PythonBridgeError", errLine!!)
                                    this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to "[STDERR] $errLine"))
                                }
                            }
                        } catch (ignored: Exception) {}
                    }.start()

                    promise.resolve(true)
                } catch (e: Exception) {
                    this@TermuxNativeModule.sendEvent("onTermuxLog", mapOf("message" to "[STDERR] Bridge Start Error: ${e.message}"))
                    promise.reject("BRIDGE_START_ERROR", e.message ?: "Bridge failed", e)
                }
            }.start()
        }

        Function("sendToPython") { message: String ->
            try {
                mPythonStdin?.write(message + "\n")
                mPythonStdin?.flush()
            } catch (e: Exception) {
                Log.e("TermuxNative", "Failed to write to Python stdin: ${e.message}")
            }
        }
    }

    private fun buildEnvironment(usrDir: File, homeDir: File): Map<String, String> {
        val usrLib = File(usrDir, "lib").absolutePath
        val usrBin = File(usrDir, "bin").absolutePath
        val homeLocalBin = File(homeDir, ".local/bin").absolutePath
        val nativeLibDir = context.applicationInfo.nativeLibraryDir
        val termuxExec = File(nativeLibDir, "libtermux-exec.so")
        val cacheDir = context.cacheDir.absolutePath

        // Ensure all APT and DPKG runtime database directories exist
        File(context.cacheDir, "apt/archives/partial").mkdirs()
        File(usrDir, "var/cache/apt/archives/partial").mkdirs()
        File(usrDir, "var/lib/dpkg/info").mkdirs()
        File(usrDir, "var/lib/dpkg/updates").mkdirs()
        File(usrDir, "var/lib/dpkg/triggers").mkdirs()
        File(usrDir, "var/log/apt").mkdirs()
        File(usrDir, "etc/apt/apt.conf.d").mkdirs()
        File(usrDir, "etc/apt/preferences.d").mkdirs()

        val statusFile = File(usrDir, "var/lib/dpkg/status")
        if (!statusFile.exists()) {
            try { statusFile.createNewFile() } catch (ignored: Exception) {}
        }
        val availableFile = File(usrDir, "var/lib/dpkg/available")
        if (!availableFile.exists()) {
            try { availableFile.createNewFile() } catch (ignored: Exception) {}
        }

        val env = mutableMapOf(
            "HOME" to homeDir.absolutePath,
            "PREFIX" to usrDir.absolutePath,
            "TERMUX_PREFIX" to usrDir.absolutePath,
            "CACHE_DIR" to cacheDir,
            "PATH" to "$homeLocalBin:$usrBin:/system/bin",
            "LD_LIBRARY_PATH" to "$nativeLibDir:$usrLib",
            "TMPDIR" to File(usrDir, "tmp").absolutePath,
            "TERM" to "xterm-256color",
            "LANG" to "en_US.UTF-8",
            "PYTHONUNBUFFERED" to "1",
            "ANDROID_DATA" to "/data",
            "ANDROID_ROOT" to "/system"
        )

        // Inject our native execve interceptor into every child process
        if (termuxExec.exists()) {
            env["LD_PRELOAD"] = termuxExec.absolutePath
        }

        return env
    }

    private fun copyAssetFile(assetName: String, destFile: File) {
        context.assets.open(assetName).use { input ->
            FileOutputStream(destFile).use { output ->
                val buf = ByteArray(4096)
                var len: Int
                while (input.read(buf).also { len = it } > 0) {
                    output.write(buf, 0, len)
                }
            }
        }
    }
}
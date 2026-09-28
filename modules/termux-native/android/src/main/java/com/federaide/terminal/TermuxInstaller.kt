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
import android.system.Os
import android.util.Log
import java.io.*
import java.util.zip.ZipInputStream

object TermuxInstaller {
    private const val TAG = "TermuxInstaller"

    interface LogCallback {
        fun onLog(message: String)
    }

    @JvmStatic
    fun fixPermissionsRecursive(dir: File) {
        if (!dir.exists()) return
        try { Os.chmod(dir.absolutePath, 493) /* 0755 */ } catch (e: Exception) {}
        dir.listFiles()?.forEach { file ->
            if (file.isDirectory) {
                fixPermissionsRecursive(file)
            } else {
                try { Os.chmod(file.absolutePath, 493) /* 0755 rwxr-xr-x */ } catch (e: Exception) {}
            }
        }
    }

    @JvmStatic
    fun setupVirtualTermuxSymlinks(filesDir: File) {
        try {
            val fakeDataDir = File(filesDir, "data/data/com.termux/files")
            fakeDataDir.mkdirs()

            val symlinkUsr = File(fakeDataDir, "usr")
            if (symlinkUsr.exists()) symlinkUsr.delete()
            try { Os.symlink("/usr", symlinkUsr.absolutePath) } catch (e: Exception) {}

            val symlinkHome = File(fakeDataDir, "home")
            if (symlinkHome.exists()) symlinkHome.delete()
            try { Os.symlink("/home", symlinkHome.absolutePath) } catch (e: Exception) {}

            File(filesDir, "tmp").mkdirs()
        } catch (e: Exception) {
            Log.w(TAG, "Error creating virtual symlinks: ${e.message}")
        }
    }

    @JvmStatic
    fun isInstalled(context: Context): Boolean {
        val filesDir = context.filesDir
        val prefix = File(filesDir, "usr")
        return File(prefix, "bin/sh").exists() || File(prefix, "bin/bash").exists()
    }

    private fun findAsset(context: Context, prefix: String, fallback: String): String {
        try {
            val assets = context.assets.list("")
            if (assets != null) {
                for (asset in assets) {
                    if (asset.equals(fallback, ignoreCase = true) || asset.startsWith(prefix)) {
                        return asset
                    }
                }
            }
        } catch (e: IOException) {
            Log.e(TAG, "Error listing assets", e)
        }
        return fallback
    }

    @JvmStatic
    fun installEnvironment(context: Context, logCb: LogCallback?) {
        val filesDir = context.filesDir
        val stagingDir = File(filesDir, "usr-staging")
        val prefixDir = File(filesDir, "usr")
        val homeDir = File(filesDir, "home")

        homeDir.mkdirs()
        if (stagingDir.exists()) deleteRecursive(stagingDir)
        stagingDir.mkdirs()
        File(stagingDir, "tmp").mkdirs()

        val bootstrapAssetName = findAsset(context, "bootstrap", "bootstrap-aarch64.zip")
        logCb?.onLog("[INSTALLER] Unpacking Termux rootfs from $bootstrapAssetName...")

        val buffer = ByteArray(8192)
        val symlinks = mutableListOf<Pair<String, String>>()

        ZipInputStream(BufferedInputStream(context.assets.open(bootstrapAssetName))).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val name = entry.name
                if (name == "SYMLINKS.txt") {
                    val reader = BufferedReader(InputStreamReader(zis))
                    var line = reader.readLine()
                    while (line != null) {
                        val parts = line.split("←")
                        if (parts.size == 2) {
                            symlinks.add(Pair(parts[0], stagingDir.absolutePath + "/" + parts[1]))
                        }
                        line = reader.readLine()
                    }
                } else {
                    val target = File(stagingDir, name)
                    if (entry.isDirectory) {
                        target.mkdirs()
                    } else {
                        target.parentFile?.mkdirs()
                        FileOutputStream(target).use { fos ->
                            var read: Int
                            while (zis.read(buffer).also { read = it } != -1) {
                                fos.write(buffer, 0, read)
                            }
                        }
                        try { Os.chmod(target.absolutePath, 493) /* 0755 */ } catch (e: Exception) {}
                    }
                }
                entry = zis.nextEntry
            }
        }

        logCb?.onLog("[INSTALLER] Creating POSIX symlinks (${symlinks.size} links)...")
        for (link in symlinks) {
            val linkFile = File(link.second)
            linkFile.parentFile?.mkdirs()
            if (linkFile.exists()) linkFile.delete()
            try {
                Os.symlink(link.first, link.second)
            } catch (e: Exception) {
                Log.w(TAG, "Symlink error: ${link.first} -> ${link.second}", e)
            }
        }

        if (prefixDir.exists()) deleteRecursive(prefixDir)
        stagingDir.renameTo(prefixDir)
        File(prefixDir, "tmp").mkdirs()

        // Populate trusted.gpg.d with real physical GPG keys from share/termux-keyring
        try {
            val gpgShareDir = File(prefixDir, "share/termux-keyring")
            val gpgAptDir = File(prefixDir, "etc/apt/trusted.gpg.d")
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

        // Create the virtual Termux path mappings (/data/data/com.termux/files -> /usr and /home)
        setupVirtualTermuxSymlinks(filesDir)

        // Fix all permissions across entire rootfs and home
        fixPermissionsRecursive(filesDir)

        logCb?.onLog("[INSTALLER] Termux rootfs installation completed successfully.")
    }

    private fun deleteRecursive(fileOrDir: File) {
        if (fileOrDir.isDirectory) {
            fileOrDir.listFiles()?.forEach { deleteRecursive(it) }
        }
        fileOrDir.delete()
    }
}
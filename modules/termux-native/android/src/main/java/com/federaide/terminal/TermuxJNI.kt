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

import android.util.Log

object TermuxJNI {
    init {
        try {
            System.loadLibrary("termux")
        } catch (e: Throwable) {
            Log.e("TermuxJNI", "Failed to load native library libtermux.so: ${e.message}")
        }
    }

    @JvmStatic external fun createSubprocess(cmd: String, cwd: String, args: Array<String>?, envVars: Array<String>?, processId: IntArray, rows: Int, columns: Int): Int
    @JvmStatic external fun waitFor(processId: Int): Int
    @JvmStatic external fun close(fileDescriptor: Int)
}
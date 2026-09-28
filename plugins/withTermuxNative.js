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

const { withAppBuildGradle, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const CMAKE_LISTS = `cmake_minimum_required(VERSION 3.13)
project(appmodules)

if(REACT_ANDROID_DIR)
    include(\${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)
endif()

# 1. Termux PTY helper
add_library(termux SHARED termux.c)
find_library(log-lib log)
target_link_libraries(termux \${log-lib})

# 2. Complete Termux VFS + execve interceptor
add_library(termux-exec SHARED termux-exec.c)
find_library(dl-lib dl)
target_link_libraries(termux-exec \${dl-lib} \${log-lib})
`;

const TERMUX_C = `#include <dirent.h>
#include <fcntl.h>
#include <jni.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

static int throw_runtime_exception(JNIEnv* env, char const* message) {
    jclass exClass = (*env)->FindClass(env, "java/lang/RuntimeException");
    (*env)->ThrowNew(env, exClass, message);
    return -1;
}

static int create_subprocess(JNIEnv* env, char const* cmd, char const* cwd, char* const argv[], char** envp, int* pProcessId, jint rows, jint columns) {
    int ptm = open("/dev/ptmx", O_RDWR | O_CLOEXEC);
    if (ptm < 0) return throw_runtime_exception(env, "Cannot open /dev/ptmx");

    char devname[64];
    if (grantpt(ptm) || unlockpt(ptm) || ptsname_r(ptm, devname, sizeof(devname))) {
        close(ptm);
        return throw_runtime_exception(env, "Cannot grantpt/ptsname on /dev/ptmx");
    }

    struct termios tios;
    tcgetattr(ptm, &tios);
    tios.c_iflag |= IUTF8;
    tios.c_iflag &= ~(IXON | IXOFF);
    tcsetattr(ptm, TCSANOW, &tios);

    struct winsize sz = { .ws_row = (unsigned short) rows, .ws_col = (unsigned short) columns };
    ioctl(ptm, TIOCSWINSZ, &sz);

    pid_t pid = fork();
    if (pid < 0) {
        close(ptm);
        return throw_runtime_exception(env, "Fork failed");
    } else if (pid > 0) {
        *pProcessId = (int) pid;
        return ptm;
    } else {
        sigset_t signals_to_unblock;
        sigfillset(&signals_to_unblock);
        sigprocmask(SIG_UNBLOCK, &signals_to_unblock, 0);

        close(ptm);
        setsid();

        int pts = open(devname, O_RDWR);
        if (pts < 0) _exit(-1);

        dup2(pts, 0); dup2(pts, 1); dup2(pts, 2);

        DIR* self_dir = opendir("/proc/self/fd");
        if (self_dir != NULL) {
            int self_dir_fd = dirfd(self_dir);
            struct entry;
            struct dirent* entry_ptr;
            while ((entry_ptr = readdir(self_dir)) != NULL) {
                int fd = atoi(entry_ptr->d_name);
                if (fd > 2 && fd != self_dir_fd) close(fd);
            }
            closedir(self_dir);
        }

        clearenv();
        if (envp) for (; *envp; ++envp) putenv(*envp);

        if (chdir(cwd) != 0) fflush(stderr);
        execvp(cmd, argv);
        _exit(1);
    }
}

JNIEXPORT jint JNICALL Java_com_federaide_terminal_TermuxJNI_createSubprocess(
        JNIEnv* env, jclass clazz, jstring cmd, jstring cwd, jobjectArray args, jobjectArray envVars, jintArray processIdArray, jint rows, jint columns) {
    (void)clazz;
    jsize size = args ? (*env)->GetArrayLength(env, args) : 0;
    char** argv = NULL;
    if (size > 0) {
        argv = (char**) malloc((size + 1) * sizeof(char*));
        for (int i = 0; i < size; ++i) {
            jstring arg_java_string = (jstring) (*env)->GetObjectArrayElement(env, args, i);
            char const* arg_utf8 = (*env)->GetStringUTFChars(env, arg_java_string, NULL);
            argv[i] = strdup(arg_utf8);
            (*env)->ReleaseStringUTFChars(env, arg_java_string, arg_utf8);
        }
        argv[size] = NULL;
    }

    size = envVars ? (*env)->GetArrayLength(env, envVars) : 0;
    char** envp = NULL;
    if (size > 0) {
        envp = (char**) malloc((size + 1) * sizeof(char*));
        for (int i = 0; i < size; ++i) {
            jstring env_java_string = (jstring) (*env)->GetObjectArrayElement(env, envVars, i);
            char const* env_utf8 = (*env)->GetStringUTFChars(env, env_java_string, 0);
            envp[i] = strdup(env_utf8);
            (*env)->ReleaseStringUTFChars(env, env_java_string, env_utf8);
        }
        envp[size] = NULL;
    }

    int procId = 0;
    char const* cmd_cwd = (*env)->GetStringUTFChars(env, cwd, NULL);
    char const* cmd_utf8 = (*env)->GetStringUTFChars(env, cmd, NULL);
    int ptm = create_subprocess(env, cmd_utf8, cmd_cwd, argv, envp, &procId, rows, columns);
    (*env)->ReleaseStringUTFChars(env, cmd, cmd_utf8);
    (*env)->ReleaseStringUTFChars(env, cwd, cmd_cwd);

    if (argv) { for (char** tmp = argv; *tmp; ++tmp) free(*tmp); free(argv); }
    if (envp) { for (char** tmp = envp; *tmp; ++tmp) free(*tmp); free(envp); }

    int* pProcId = (int*) (*env)->GetPrimitiveArrayCritical(env, processIdArray, NULL);
    *pProcId = procId;
    (*env)->ReleasePrimitiveArrayCritical(env, processIdArray, pProcId, 0);

    return ptm;
}

JNIEXPORT jint JNICALL Java_com_federaide_terminal_TermuxJNI_waitFor(JNIEnv* env, jclass clazz, jint pid) {
    (void)env; (void)clazz;
    int status;
    waitpid(pid, &status, 0);
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return -WTERMSIG(status);
    return 0;
}

JNIEXPORT void JNICALL Java_com_federaide_terminal_TermuxJNI_close(JNIEnv* env, jclass clazz, jint fd) {
    (void)env; (void)clazz;
    close(fd);
}
`;

const TERMUX_EXEC_C = `#define _GNU_SOURCE
#include <dlfcn.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/vfs.h>
#include <dirent.h>
#include <stdarg.h>
#include <utime.h>
#include <sys/time.h>
#include <spawn.h>
#include <limits.h>

static int (*real_posix_spawn)(pid_t *, const char *, const posix_spawn_file_actions_t *, const posix_spawnattr_t *, char *const [], char *const []) = NULL;
static int (*real_posix_spawnp)(pid_t *, const char *, const posix_spawn_file_actions_t *, const posix_spawnattr_t *, char *const [], char *const []) = NULL;

static const char *LINKER = "/system/bin/linker64";
static int (*real_statvfs)(const char *, struct statvfs *) = NULL;
static int (*real_statfs)(const char *, struct statfs *) = NULL;

static int (*real_execve)(const char *, char *const [], char *const []) = NULL;
static int (*real_open)(const char *, int, ...) = NULL;
static int (*real_openat)(int, const char *, int, ...) = NULL;
static FILE* (*real_fopen)(const char *, const char *) = NULL;
static int (*real_access)(const char *, int) = NULL;
static int (*real_faccessat)(int, const char *, int, int) = NULL;
static int (*real_stat)(const char *, struct stat *) = NULL;
static int (*real_lstat)(const char *, struct stat *) = NULL;
static int (*real_fstatat)(int, const char *, struct stat *, int) = NULL;
static DIR* (*real_opendir)(const char *) = NULL;
static int (*real_scandir)(const char *, struct dirent ***, int (*)(const struct dirent *), int (*)(const struct dirent **, const struct dirent **)) = NULL;
static int (*real_mkdir)(const char *, mode_t) = NULL;
static int (*real_mkdirat)(int, const char *, mode_t) = NULL;
static int (*real_rmdir)(const char *) = NULL;
static int (*real_unlink)(const char *) = NULL;
static int (*real_unlinkat)(int, const char *, int) = NULL;
static int (*real_remove)(const char *) = NULL;
static int (*real_rename)(const char *, const char *) = NULL;
static int (*real_renameat)(int, const char *, int, const char *) = NULL;
static int (*real_renameat2)(int, const char *, int, const char *, unsigned int) = NULL;
static ssize_t (*real_readlink)(const char *, char *, size_t) = NULL;
static ssize_t (*real_readlinkat)(int, const char *, char *, size_t) = NULL;
static char* (*real_realpath)(const char *, char *) = NULL;
static int (*real_chdir)(const char *) = NULL;
static int (*real_chmod)(const char *, mode_t) = NULL;
static int (*real_fchmodat)(int, const char *, mode_t, int) = NULL;
static int (*real_symlink)(const char *, const char *) = NULL;
static int (*real_symlinkat)(const char *, int, const char *) = NULL;
static int (*real_link)(const char *, const char *) = NULL;
static int (*real_linkat)(int, const char *, int, const char *, int) = NULL;
static int (*real_utime)(const char *, const struct utimbuf *) = NULL;
static int (*real_utimes)(const char *, const struct timeval [2]) = NULL;
static int (*real_utimensat)(int, const char *, const struct timespec [2], int) = NULL;

__attribute__((constructor)) static void init(void) {
    real_execve = dlsym(RTLD_NEXT, "execve");
    real_open = dlsym(RTLD_NEXT, "open");
    real_openat = dlsym(RTLD_NEXT, "openat");
    real_fopen = dlsym(RTLD_NEXT, "fopen");
    real_access = dlsym(RTLD_NEXT, "access");
    real_faccessat = dlsym(RTLD_NEXT, "faccessat");
    real_stat = dlsym(RTLD_NEXT, "stat");
    real_lstat = dlsym(RTLD_NEXT, "lstat");
    real_fstatat = dlsym(RTLD_NEXT, "fstatat");
    real_opendir = dlsym(RTLD_NEXT, "opendir");
    real_scandir = dlsym(RTLD_NEXT, "scandir");
    real_mkdir = dlsym(RTLD_NEXT, "mkdir");
    real_mkdirat = dlsym(RTLD_NEXT, "mkdirat");
    real_rmdir = dlsym(RTLD_NEXT, "rmdir");
    real_unlink = dlsym(RTLD_NEXT, "unlink");
    real_unlinkat = dlsym(RTLD_NEXT, "unlinkat");
    real_remove = dlsym(RTLD_NEXT, "remove");
    real_rename = dlsym(RTLD_NEXT, "rename");
    real_renameat = dlsym(RTLD_NEXT, "renameat");
    real_readlink = dlsym(RTLD_NEXT, "readlink");
    real_readlinkat = dlsym(RTLD_NEXT, "readlinkat");
    real_realpath = dlsym(RTLD_NEXT, "realpath");
    real_chdir = dlsym(RTLD_NEXT, "chdir");
    real_chmod = dlsym(RTLD_NEXT, "chmod");
    real_fchmodat = dlsym(RTLD_NEXT, "fchmodat");
    real_symlink = dlsym(RTLD_NEXT, "symlink");
    real_symlinkat = dlsym(RTLD_NEXT, "symlinkat");
    real_link = dlsym(RTLD_NEXT, "link");
    real_linkat = dlsym(RTLD_NEXT, "linkat");
    real_utime = dlsym(RTLD_NEXT, "utime");
    real_utimes = dlsym(RTLD_NEXT, "utimes");
    real_utimensat = dlsym(RTLD_NEXT, "utimensat");
    real_posix_spawn = dlsym(RTLD_NEXT, "posix_spawn");
    real_posix_spawnp = dlsym(RTLD_NEXT, "posix_spawnp");
}

static const char* get_prefix() {
    const char *p = getenv("PREFIX");
    return p ? p : "/data/data/in.rocklab.federaide/files/usr";
}

static const char* get_home() {
    const char *h = getenv("HOME");
    return h ? h : "/data/data/in.rocklab.federaide/files/home";
}

static const char* get_cache() {
    const char *c = getenv("CACHE_DIR");
    return c ? c : "/data/data/in.rocklab.federaide/cache";
}

static int rewrite_path(const char *in, char *out, size_t out_len) {
    if (!in || !out || out_len == 0) return 0;

    // Strip leading ./ prefixes (handles relative paths extracted by DPKG)
    const char *p = in;
    while (p[0] == '.' && p[1] == '/') p += 2;
    const char *np = (p[0] == '/') ? (p + 1) : p;

    const char *prefix = get_prefix();
    const char *home = get_home();
    const char *cache = get_cache();

    // 1. Match data/data/com.termux/files/usr/... -> $PREFIX/...
    if (strncmp(np, "data/data/com.termux/files/usr", 30) == 0) {
        const char *rest = np + 30;
        if (*rest == '/') snprintf(out, out_len, "%s%s", prefix, rest);
        else snprintf(out, out_len, "%s", prefix);
        return 1;
    }

    // 2. Match data/data/com.termux/files/home/... -> $HOME/...
    if (strncmp(np, "data/data/com.termux/files/home", 31) == 0) {
        const char *rest = np + 31;
        if (*rest == '/') snprintf(out, out_len, "%s%s", home, rest);
        else snprintf(out, out_len, "%s", home);
        return 1;
    }

    // 3. Match data/data/com.termux/cache/... -> $CACHE_DIR/...
    if (strncmp(np, "data/data/com.termux/cache", 26) == 0) {
        const char *rest = np + 26;
        if (*rest == '/') snprintf(out, out_len, "%s%s", cache, rest);
        else snprintf(out, out_len, "%s", cache);
        return 1;
    }

    // 4. Intercept intermediate parent directories created by DPKG
    if (strcmp(np, "data/data/com.termux/files") == 0 ||
        strcmp(np, "data/data/com.termux") == 0 ||
        strcmp(np, "data/data") == 0 ||
        strcmp(np, "data") == 0) {
        snprintf(out, out_len, "%s", prefix);
        return 1;
    }

    // 5. Match tmp/...
    if (strncmp(np, "tmp/", 4) == 0) {
        snprintf(out, out_len, "%s/tmp/%s", prefix, np + 4);
        return 1;
    }
    if (strcmp(np, "tmp") == 0) {
        snprintf(out, out_len, "%s/tmp", prefix);
        return 1;
    }

    // 6. Match etc/...
    if (strncmp(np, "etc/apt", 7) == 0 || strncmp(np, "etc/termux", 10) == 0 || strncmp(np, "etc/ssl", 7) == 0) {
        snprintf(out, out_len, "%s/%s", prefix, np);
        return 1;
    }

    // 7. Match usr/...
    if (strncmp(np, "usr/", 4) == 0) {
        snprintf(out, out_len, "%s/%s", prefix, np + 4);
        return 1;
    }
    if (strcmp(np, "usr") == 0) {
        snprintf(out, out_len, "%s", prefix);
        return 1;
    }

    // 8. Match /bin/sh and /bin/bash
    if (strcmp(np, "bin/sh") == 0) {
        snprintf(out, out_len, "%s/bin/sh", prefix);
        return 1;
    }
    if (strcmp(np, "bin/bash") == 0) {
        snprintf(out, out_len, "%s/bin/bash", prefix);
        return 1;
    }

    if (strncmp(np, "usr/bin/env", 11) == 0) {
        const char *cmd = np + 11;
        while (*cmd == 32 || *cmd == 9) cmd++;
        snprintf(out, out_len, "%s/bin/%s", prefix, cmd);
        return 1;
    }

    strncpy(out, in, out_len - 1);
    out[out_len - 1] = 0;
    return 0;
}

static void ensure_parent_dir(const char *path) {
    if (!path) return;
    if (!real_mkdir) real_mkdir = dlsym(RTLD_NEXT, "mkdir");
    char temp[512];
    strncpy(temp, path, sizeof(temp) - 1);
    temp[sizeof(temp) - 1] = 0;

    char *slash = strrchr(temp, '/');
    if (!slash || slash == temp) return;
    *slash = 0;

    char *p = temp + 1;
    while (*p) {
        if (*p == '/') {
            *p = 0;
            if (real_mkdir) real_mkdir(temp, 0755);
            *p = '/';
        }
        p++;
    }
    if (real_mkdir) real_mkdir(temp, 0755);
}

int open64(const char *pathname, int flags, ...) {
    if (!real_open) real_open = dlsym(RTLD_NEXT, "open");
    if (!real_mkdir) real_mkdir = dlsym(RTLD_NEXT, "mkdir");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));

    if (flags & O_CREAT) {
        va_list args;
        va_start(args, flags);
        mode_t mode = (mode_t)va_arg(args, int);
        va_end(args);

        int fd = real_open(rpath, flags, mode);
        if (fd < 0 && errno == ENOENT) {
            ensure_parent_dir(rpath);
            fd = real_open(rpath, flags, mode);
        }
        return fd;
    }
    return real_open(rpath, flags);
}

int openat64(int dirfd, const char *pathname, int flags, ...) {
    if (!real_openat) real_openat = dlsym(RTLD_NEXT, "openat");
    if (!real_mkdir) real_mkdir = dlsym(RTLD_NEXT, "mkdir");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));

    if (flags & O_CREAT) {
        va_list args;
        va_start(args, flags);
        mode_t mode = (mode_t)va_arg(args, int);
        va_end(args);

        int fd = real_openat(dirfd, rpath, flags, mode);
        if (fd < 0 && errno == ENOENT) {
            ensure_parent_dir(rpath);
            fd = real_openat(dirfd, rpath, flags, mode);
        }
        return fd;
    }
    return real_openat(dirfd, rpath, flags);
}

int creat(const char *pathname, mode_t mode) {
    return open(pathname, O_CREAT | O_WRONLY | O_TRUNC, mode);
}

int creat64(const char *pathname, mode_t mode) {
    return open(pathname, O_CREAT | O_WRONLY | O_TRUNC, mode);
}

// 1. Intercept open(), openat(), fopen()
int open(const char *pathname, int flags, ...) {
    if (!real_open) real_open = dlsym(RTLD_NEXT, "open");
    if (!real_mkdir) real_mkdir = dlsym(RTLD_NEXT, "mkdir");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));

    if (flags & O_CREAT) {
        va_list args;
        va_start(args, flags);
        mode_t mode = (mode_t)va_arg(args, int);
        va_end(args);

        int fd = real_open(rpath, flags, mode);
        if (fd < 0 && errno == ENOENT) {
            ensure_parent_dir(rpath);
            fd = real_open(rpath, flags, mode);
        }
        return fd;
    }
    return real_open(rpath, flags);
}

int openat(int dirfd, const char *pathname, int flags, ...) {
    if (!real_openat) real_openat = dlsym(RTLD_NEXT, "openat");
    if (!real_mkdir) real_mkdir = dlsym(RTLD_NEXT, "mkdir");

    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list args;
        va_start(args, flags);
        mode = (mode_t)va_arg(args, int);
        va_end(args);
    }
    if (!pathname) return (flags & O_CREAT) ? real_openat(dirfd, NULL, flags, mode) : real_openat(dirfd, NULL, flags);

    // If opening relative to an existing directory descriptor, do not rewrite relative child names
    if (dirfd != AT_FDCWD && pathname[0] != '/' && strncmp(pathname, "./data/data/com.termux", 22) != 0) {
        return (flags & O_CREAT) ? real_openat(dirfd, pathname, flags, mode) : real_openat(dirfd, pathname, flags);
    }

    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));

    if (flags & O_CREAT) {
        int fd = real_openat(dirfd, rpath, flags, mode);
        if (fd < 0 && errno == ENOENT) {
            ensure_parent_dir(rpath);
            fd = real_openat(dirfd, rpath, flags, mode);
        }
        return fd;
    }
    return real_openat(dirfd, rpath, flags);
}

FILE *fopen(const char *pathname, const char *mode) {
    if (!real_fopen) real_fopen = dlsym(RTLD_NEXT, "fopen");
    if (!real_mkdir) real_mkdir = dlsym(RTLD_NEXT, "mkdir");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    FILE *fp = real_fopen(rpath, mode);
    if (!fp && errno == ENOENT && mode && (strchr(mode, 'w') || strchr(mode, 'a'))) {
        ensure_parent_dir(rpath);
        fp = real_fopen(rpath, mode);
    }
    return fp;
}

// 2. Intercept opendir() & scandir()
DIR *opendir(const char *name) {
    if (!real_opendir) real_opendir = dlsym(RTLD_NEXT, "opendir");
    char rpath[512];
    rewrite_path(name, rpath, sizeof(rpath));
    return real_opendir(rpath);
}

int scandir(const char *dirp, struct dirent ***namelist,
            int (*filter)(const struct dirent *),
            int (*compar)(const struct dirent **, const struct dirent **)) {
    if (!real_scandir) real_scandir = dlsym(RTLD_NEXT, "scandir");
    char rpath[512];
    rewrite_path(dirp, rpath, sizeof(rpath));
    return real_scandir(rpath, namelist, filter, compar);
}

// 3. Intercept access() & faccessat()
int access(const char *pathname, int mode) {
    if (!real_access) real_access = dlsym(RTLD_NEXT, "access");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_access(rpath, mode);
}

int faccessat(int dirfd, const char *pathname, int mode, int flags) {
    if (!real_faccessat) real_faccessat = dlsym(RTLD_NEXT, "faccessat");
    if (!pathname) return real_faccessat(dirfd, NULL, mode, flags);
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_faccessat(dirfd, rpath, mode, flags);
}

// 4. Intercept stat(), lstat(), fstatat()
int stat(const char *pathname, struct stat *statbuf) {
    if (!real_stat) real_stat = dlsym(RTLD_NEXT, "stat");
    if (!pathname) { errno = EFAULT; return -1; }
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_stat(rpath, statbuf);
}

int lstat(const char *pathname, struct stat *statbuf) {
    if (!real_lstat) real_lstat = dlsym(RTLD_NEXT, "lstat");
    if (!pathname) { errno = EFAULT; return -1; }
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_lstat(rpath, statbuf);
}

int fstatat(int dirfd, const char *pathname, struct stat *statbuf, int flags) {
    if (!real_fstatat) real_fstatat = dlsym(RTLD_NEXT, "fstatat");
    if (!pathname) return real_fstatat(dirfd, NULL, statbuf, flags);
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_fstatat(dirfd, rpath, statbuf, flags);
}

// 5. Intercept mkdir(), rmdir(), unlink(), rename()
int mkdir(const char *pathname, mode_t mode) {
    if (!real_mkdir) real_mkdir = dlsym(RTLD_NEXT, "mkdir");
    if (!real_stat) real_stat = dlsym(RTLD_NEXT, "stat");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));

    struct stat st;
    if (real_stat && real_stat(rpath, &st) == 0 && S_ISDIR(st.st_mode)) {
        return 0; // Prevent EEXIST/EACCES when DPKG creates existing prefix directories
    }
    return real_mkdir(rpath, mode);
}

int mkdirat(int dirfd, const char *pathname, mode_t mode) {
    if (!real_mkdirat) real_mkdirat = dlsym(RTLD_NEXT, "mkdirat");
    if (!real_stat) real_stat = dlsym(RTLD_NEXT, "stat");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));

    struct stat st;
    if (real_stat && real_stat(rpath, &st) == 0 && S_ISDIR(st.st_mode)) {
        return 0;
    }
    return real_mkdirat(dirfd, rpath, mode);
}

int rmdir(const char *pathname) {
    if (!real_rmdir) real_rmdir = dlsym(RTLD_NEXT, "rmdir");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    if (strcmp(rpath, get_prefix()) == 0 || strcmp(rpath, get_home()) == 0) return 0;
    return real_rmdir(rpath);
}

int unlink(const char *pathname) {
    if (!real_unlink) real_unlink = dlsym(RTLD_NEXT, "unlink");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    if (strcmp(rpath, get_prefix()) == 0 || strcmp(rpath, get_home()) == 0) return 0;
    return real_unlink(rpath);
}

int unlinkat(int dirfd, const char *pathname, int flags) {
    if (!real_unlinkat) real_unlinkat = dlsym(RTLD_NEXT, "unlinkat");
    if (!pathname) return real_unlinkat ? real_unlinkat(dirfd, NULL, flags) : -1;
    if (dirfd != AT_FDCWD && pathname[0] != '/' && strncmp(pathname, "./data/data/com.termux", 22) != 0) {
        return real_unlinkat(dirfd, pathname, flags);
    }
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    if (strcmp(rpath, get_prefix()) == 0 || strcmp(rpath, get_home()) == 0) return 0;
    return real_unlinkat(dirfd, rpath, flags);
}

int remove(const char *pathname) {
    if (!real_remove) real_remove = dlsym(RTLD_NEXT, "remove");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_remove(rpath);
}

int rename(const char *oldpath, const char *newpath) {
    if (!real_rename) real_rename = dlsym(RTLD_NEXT, "rename");
    char rold[512], rnew[512];
    rewrite_path(oldpath, rold, sizeof(rold));
    rewrite_path(newpath, rnew, sizeof(rnew));
    return real_rename(rold, rnew);
}

int renameat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath) {
    if (!real_renameat) real_renameat = dlsym(RTLD_NEXT, "renameat");
    char rold[512], rnew[512];
    rewrite_path(oldpath, rold, sizeof(rold));
    rewrite_path(newpath, rnew, sizeof(rnew));
    return real_renameat(olddirfd, rold, newdirfd, rnew);
}

int renameat2(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, unsigned int flags) {
    if (!real_renameat2) real_renameat2 = dlsym(RTLD_NEXT, "renameat2");
    char rold[512], rnew[512];
    rewrite_path(oldpath, rold, sizeof(rold));
    rewrite_path(newpath, rnew, sizeof(rnew));
    if (real_renameat2) {
        return real_renameat2(olddirfd, rold, newdirfd, rnew, flags);
    }
    return renameat(olddirfd, oldpath, newdirfd, newpath);
}

// Ensure LD_PRELOAD, PREFIX and TERMUX_EXEC__PROC_SELF_EXE are preserved across executions
static char** ensure_env(char *const envp[], const char *self_exe) {
    char *const *src = envp ? envp : environ;
    int count = 0;
    int has_preload = 0, has_prefix = 0, has_ld_path = 0, has_path = 0, has_self_exe = 0;

    if (src) {
        while (src[count]) {
            if (strncmp(src[count], "LD_PRELOAD=", 11) == 0) has_preload = 1;
            if (strncmp(src[count], "PREFIX=", 7) == 0) has_prefix = 1;
            if (strncmp(src[count], "LD_LIBRARY_PATH=", 16) == 0) has_ld_path = 1;
            if (strncmp(src[count], "PATH=", 5) == 0) has_path = 1;
            if (strncmp(src[count], "TERMUX_EXEC__PROC_SELF_EXE=", 27) == 0) has_self_exe = 1;
            count++;
        }
    }

    char **new_env = (char **)malloc((count + 10) * sizeof(char *));
    int j = 0;
    if (src) {
        for (int i = 0; i < count; i++) {
            if (self_exe && strncmp(src[i], "TERMUX_EXEC__PROC_SELF_EXE=", 27) == 0) {
                char *buf = (char *)malloc(512);
                snprintf(buf, 512, "TERMUX_EXEC__PROC_SELF_EXE=%s", self_exe);
                new_env[j++] = buf;
                has_self_exe = 1;
            } else {
                new_env[j++] = src[i];
            }
        }
    }

    if (!has_preload && getenv("LD_PRELOAD")) {
        char *buf = (char *)malloc(512);
        snprintf(buf, 512, "LD_PRELOAD=%s", getenv("LD_PRELOAD"));
        new_env[j++] = buf;
    }
    if (!has_prefix && getenv("PREFIX")) {
        char *buf = (char *)malloc(512);
        snprintf(buf, 512, "PREFIX=%s", getenv("PREFIX"));
        new_env[j++] = buf;
    }
    if (!has_ld_path && getenv("LD_LIBRARY_PATH")) {
        char *buf = (char *)malloc(512);
        snprintf(buf, 512, "LD_LIBRARY_PATH=%s", getenv("LD_LIBRARY_PATH"));
        new_env[j++] = buf;
    }
    if (!has_path && getenv("PATH")) {
        char *buf = (char *)malloc(512);
        snprintf(buf, 512, "PATH=%s", getenv("PATH"));
        new_env[j++] = buf;
    }
    int has_goroot = 0, has_cgo = 0, has_cc = 0, has_pkg = 0;
    if (src) {
        for (int i = 0; i < count; i++) {
            if (strncmp(src[i], "GOROOT=", 7) == 0) has_goroot = 1;
            if (strncmp(src[i], "CGO_ENABLED=", 12) == 0) has_cgo = 1;
            if (strncmp(src[i], "CC=", 3) == 0) has_cc = 1;
            if (strncmp(src[i], "PKG_CONFIG_PATH=", 16) == 0) has_pkg = 1;
        }
    }
    if (!has_goroot) {
        const char *env_goroot = getenv("GOROOT");
        char *buf = (char *)malloc(512);
        if (env_goroot && *env_goroot) {
            char r_goroot[512];
            rewrite_path(env_goroot, r_goroot, sizeof(r_goroot));
            snprintf(buf, 512, "GOROOT=%s", r_goroot);
        } else {
            snprintf(buf, 512, "GOROOT=%s/lib/go", get_prefix());
        }
        new_env[j++] = buf;
    }
    if (!has_cgo) {
        char *buf = (char *)malloc(32);
        snprintf(buf, 32, "CGO_ENABLED=1");
        new_env[j++] = buf;
    }
    if (!has_cc) {
        char *buf = (char *)malloc(64);
        snprintf(buf, 64, "CC=clang");
        new_env[j++] = buf;
    }
    if (!has_pkg) {
        char *buf = (char *)malloc(512);
        snprintf(buf, 512, "PKG_CONFIG_PATH=%s/lib/pkgconfig:%s/share/pkgconfig", get_prefix(), get_prefix());
        new_env[j++] = buf;
    }
    if (self_exe && !has_self_exe) {
        char *buf = (char *)malloc(512);
        snprintf(buf, 512, "TERMUX_EXEC__PROC_SELF_EXE=%s", self_exe);
        new_env[j++] = buf;
    }

    new_env[j] = NULL;
    return new_env;
}

// 6. Intercept readlink(), realpath(), chdir(), chmod()
ssize_t readlink(const char *pathname, char *buf, size_t bufsiz) {
    if (pathname && strcmp(pathname, "/proc/self/exe") == 0) {
        const char *self_exe = getenv("TERMUX_EXEC__PROC_SELF_EXE");
        if (self_exe && *self_exe) {
            if (!real_realpath) real_realpath = dlsym(RTLD_NEXT, "realpath");
            char resolved_buf[512];
            char *resolved = real_realpath ? real_realpath(self_exe, resolved_buf) : NULL;
            const char *final_exe = resolved ? resolved : self_exe;
            size_t len = strlen(final_exe);
            size_t n = (len < bufsiz) ? len : bufsiz;
            memcpy(buf, final_exe, n);
            return (ssize_t)n;
        }
    }
    if (!real_readlink) real_readlink = dlsym(RTLD_NEXT, "readlink");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_readlink(rpath, buf, bufsiz);
}

ssize_t readlinkat(int dirfd, const char *pathname, char *buf, size_t bufsiz) {
    if (pathname && (strcmp(pathname, "/proc/self/exe") == 0 || (dirfd == AT_FDCWD && strcmp(pathname, "proc/self/exe") == 0))) {
        const char *self_exe = getenv("TERMUX_EXEC__PROC_SELF_EXE");
        if (self_exe && *self_exe) {
            if (!real_realpath) real_realpath = dlsym(RTLD_NEXT, "realpath");
            char resolved_buf[512];
            char *resolved = real_realpath ? real_realpath(self_exe, resolved_buf) : NULL;
            const char *final_exe = resolved ? resolved : self_exe;
            size_t len = strlen(final_exe);
            size_t n = (len < bufsiz) ? len : bufsiz;
            memcpy(buf, final_exe, n);
            return (ssize_t)n;
        }
    }
    if (!real_readlinkat) real_readlinkat = dlsym(RTLD_NEXT, "readlinkat");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_readlinkat(dirfd, rpath, buf, bufsiz);
}

char *realpath(const char *path, char *resolved_path) {
    if (path && strcmp(path, "/proc/self/exe") == 0) {
        const char *self_exe = getenv("TERMUX_EXEC__PROC_SELF_EXE");
        if (self_exe && *self_exe) {
            if (!real_realpath) real_realpath = dlsym(RTLD_NEXT, "realpath");
            char resolved_buf[512];
            char *resolved = real_realpath ? real_realpath(self_exe, resolved_buf) : NULL;
            const char *final_exe = resolved ? resolved : self_exe;
            if (resolved_path) {
                strncpy(resolved_path, final_exe, PATH_MAX - 1);
                resolved_path[PATH_MAX - 1] = 0;
                return resolved_path;
            } else {
                return strdup(final_exe);
            }
        }
    }
    if (!real_realpath) real_realpath = dlsym(RTLD_NEXT, "realpath");
    char rpath[512];
    rewrite_path(path, rpath, sizeof(rpath));
    return real_realpath(rpath, resolved_path);
}

int chdir(const char *path) {
    if (!real_chdir) real_chdir = dlsym(RTLD_NEXT, "chdir");
    char rpath[512];
    rewrite_path(path, rpath, sizeof(rpath));
    return real_chdir(rpath);
}

int chmod(const char *pathname, mode_t mode) {
    if (!real_chmod) real_chmod = dlsym(RTLD_NEXT, "chmod");
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_chmod(rpath, mode);
}

int fchmodat(int dirfd, const char *pathname, mode_t mode, int flags) {
    if (!real_fchmodat) real_fchmodat = dlsym(RTLD_NEXT, "fchmodat");
    if (!pathname) return real_fchmodat(dirfd, NULL, mode, flags);
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_fchmodat(dirfd, rpath, mode, flags);
}

int statvfs(const char *path, struct statvfs *buf) {
    if (!real_statvfs) real_statvfs = dlsym(RTLD_NEXT, "statvfs");
    if (!path) { errno = EFAULT; return -1; }
    char rpath[512];
    rewrite_path(path, rpath, sizeof(rpath));
    return real_statvfs(rpath, buf);
}

int statfs(const char *path, struct statfs *buf) {
    if (!real_statfs) real_statfs = dlsym(RTLD_NEXT, "statfs");
    if (!path) { errno = EFAULT; return -1; }
    char rpath[512];
    rewrite_path(path, rpath, sizeof(rpath));
    return real_statfs(rpath, buf);
}

int symlink(const char *target, const char *linkpath) {
    if (!real_symlink) real_symlink = dlsym(RTLD_NEXT, "symlink");
    if (!real_mkdir) real_mkdir = dlsym(RTLD_NEXT, "mkdir");
    if (!target || !linkpath) { errno = EFAULT; return -1; }
    char rtarget[512], rlink[512];
    rewrite_path(target, rtarget, sizeof(rtarget));
    rewrite_path(linkpath, rlink, sizeof(rlink));
    int ret = real_symlink(rtarget, rlink);
    if (ret != 0 && errno == ENOENT) {
        ensure_parent_dir(rlink);
        ret = real_symlink(rtarget, rlink);
    }
    return ret;
}

int symlinkat(const char *target, int newdirfd, const char *linkpath) {
    if (!real_symlinkat) real_symlinkat = dlsym(RTLD_NEXT, "symlinkat");
    if (!target || !linkpath) { errno = EFAULT; return -1; }
    char rtarget[512], rlink[512];
    rewrite_path(target, rtarget, sizeof(rtarget));
    rewrite_path(linkpath, rlink, sizeof(rlink));
    return real_symlinkat(rtarget, newdirfd, rlink);
}

int link(const char *oldpath, const char *newpath) {
    if (!real_link) real_link = dlsym(RTLD_NEXT, "link");
    if (!oldpath || !newpath) { errno = EFAULT; return -1; }
    char rold[512], rnew[512];
    rewrite_path(oldpath, rold, sizeof(rold));
    rewrite_path(newpath, rnew, sizeof(rnew));
    return real_link(rold, rnew);
}

int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, int flags) {
    if (!real_linkat) real_linkat = dlsym(RTLD_NEXT, "linkat");
    if (!oldpath || !newpath) { errno = EFAULT; return -1; }
    char rold[512], rnew[512];
    rewrite_path(oldpath, rold, sizeof(rold));
    rewrite_path(newpath, rnew, sizeof(rnew));
    return real_linkat(olddirfd, rold, newdirfd, rnew, flags);
}

int utime(const char *filename, const struct utimbuf *times) {
    if (!real_utime) real_utime = dlsym(RTLD_NEXT, "utime");
    if (!filename) { errno = EFAULT; return -1; }
    char rpath[512];
    rewrite_path(filename, rpath, sizeof(rpath));
    return real_utime(rpath, times);
}

int utimes(const char *filename, const struct timeval times[2]) {
    if (!real_utimes) real_utimes = dlsym(RTLD_NEXT, "utimes");
    if (!filename) { errno = EFAULT; return -1; }
    char rpath[512];
    rewrite_path(filename, rpath, sizeof(rpath));
    return real_utimes(rpath, times);
}

int utimensat(int dirfd, const char *pathname, const struct timespec times[2], int flags) {
    if (!real_utimensat) real_utimensat = dlsym(RTLD_NEXT, "utimensat");
    if (!pathname) return real_utimensat(dirfd, NULL, times, flags);
    char rpath[512];
    rewrite_path(pathname, rpath, sizeof(rpath));
    return real_utimensat(dirfd, rpath, times, flags);
}

static void to_absolute_path(const char *in, char *out, size_t out_len) {
    if (!in || !out || out_len == 0) return;
    if (in[0] == '/') {
        strncpy(out, in, out_len - 1);
        out[out_len - 1] = 0;
        return;
    }
    char pwd[PATH_MAX];
    if (getcwd(pwd, sizeof(pwd)) != NULL) {
        snprintf(out, out_len, "%s/%s", pwd, in);
    } else {
        strncpy(out, in, out_len - 1);
        out[out_len - 1] = 0;
    }
}

// 7. Intercept execve()
int execve(const char *pathname, char *const argv[], char *const envp[]) {
    if (!real_execve) {
        real_execve = dlsym(RTLD_NEXT, "execve");
    }

    if (!pathname) {
        errno = EFAULT;
        return -1;
    }

    const char *target_path = pathname;
    if (strcmp(pathname, "/proc/self/exe") == 0) {
        const char *self_exe = getenv("TERMUX_EXEC__PROC_SELF_EXE");
        if (self_exe && *self_exe) target_path = self_exe;
    }

    if (strncmp(target_path, "/system/", 8) == 0 || strncmp(target_path, "/apex/", 6) == 0) {
        return real_execve(target_path, argv, envp);
    }

    char abs_target[PATH_MAX];
    to_absolute_path(target_path, abs_target, sizeof(abs_target));

    char resolved_path[PATH_MAX];
    rewrite_path(abs_target, resolved_path, sizeof(resolved_path));

    if (access(resolved_path, F_OK) != 0 && strchr(target_path, '/')) {
        errno = ENOENT;
        return -1;
    }

    int fd = open(resolved_path, O_RDONLY | O_CLOEXEC);
    if (fd >= 0) {
        char header[512];
        ssize_t n = read(fd, header, sizeof(header) - 1);
        close(fd);
        if (n > 2 && header[0] == '#' && header[1] == '!') {
            header[n] = 0;
            char *eol = strchr(header, 10);
            if (eol) *eol = 0;
            char *interp = header + 2;
            while (*interp == 32 || *interp == 9) interp++;

            char abs_interp[PATH_MAX];
            to_absolute_path(interp, abs_interp, sizeof(abs_interp));

            char resolved_interp[PATH_MAX];
            rewrite_path(abs_interp, resolved_interp, sizeof(resolved_interp));

            int argc = 0;
            while (argv && argv[argc]) argc++;

            char **new_argv = (char **)malloc((argc + 5) * sizeof(char *));
            new_argv[0] = (argv && argv[0]) ? argv[0] : (char *)LINKER;
            new_argv[1] = resolved_interp;
            new_argv[2] = resolved_path;
            for (int i = 1; i < argc; i++) {
                if (argv[i]) {
                    char *rarg = (char *)malloc(512);
                    rewrite_path(argv[i], rarg, 512);
                    new_argv[i + 2] = rarg;
                }
            }
            new_argv[argc + 2] = NULL;
            char **passed_env = ensure_env(envp, resolved_interp);
            return real_execve(LINKER, new_argv, passed_env);
        }
    }

    int argc = 0;
    while (argv && argv[argc]) argc++;

    char **new_argv = (char **)malloc((argc + 4) * sizeof(char *));
    new_argv[0] = (argv && argv[0]) ? argv[0] : (char *)LINKER;
    new_argv[1] = resolved_path;
    for (int i = 1; i < argc; i++) {
        if (argv[i]) {
            char *rarg = (char *)malloc(512);
            rewrite_path(argv[i], rarg, 512);
            new_argv[i + 1] = rarg;
        }
    }
    new_argv[argc + 1] = NULL;

    char **passed_env = ensure_env(envp, resolved_path);
    return real_execve(LINKER, new_argv, passed_env);
}

int execv(const char *pathname, char *const argv[]) {
    return execve(pathname, argv, environ);
}

int execvp(const char *file, char *const argv[]) {
    char fullpath[512];
    if (strchr(file, '/')) {
        snprintf(fullpath, sizeof(fullpath), "%s", file);
    } else {
        snprintf(fullpath, sizeof(fullpath), "%s/bin/%s", get_prefix(), file);
    }
    return execve(fullpath, argv, environ);
}

int execvpe(const char *file, char *const argv[], char *const envp[]) {
    char fullpath[512];
    if (strchr(file, '/')) {
        snprintf(fullpath, sizeof(fullpath), "%s", file);
    } else {
        snprintf(fullpath, sizeof(fullpath), "%s/bin/%s", get_prefix(), file);
    }
    return execve(fullpath, argv, envp);
}

static int __execl_helper(int is_e, int is_p, const char *name, const char *argv0, va_list ap) {
    va_list count_ap;
    va_copy(count_ap, ap);
    size_t n = 1;
    while (va_arg(count_ap, char *) != NULL) ++n;
    va_end(count_ap);

    char *argv[n + 1];
    argv[0] = (char *)argv0;
    n = 1;
    while ((argv[n] = va_arg(ap, char *)) != NULL) ++n;

    char **argp = is_e ? va_arg(ap, char **) : environ;
    return is_p ? execvp(name, argv) : execve(name, argv, argp);
}

int execl(const char *name, const char *arg, ...) {
    va_list ap;
    va_start(ap, arg);
    int res = __execl_helper(0, 0, name, arg, ap);
    va_end(ap);
    return res;
}

int execle(const char *name, const char *arg, ...) {
    va_list ap;
    va_start(ap, arg);
    int res = __execl_helper(1, 0, name, arg, ap);
    va_end(ap);
    return res;
}

int execlp(const char *name, const char *arg, ...) {
    va_list ap;
    va_start(ap, arg);
    int res = __execl_helper(0, 1, name, arg, ap);
    va_end(ap);
    return res;
}

int fexecve(int fd, char *const argv[], char *const envp[]) {
    char buf[64];
    snprintf(buf, sizeof(buf), "/proc/self/fd/%d", fd);
    return execve(buf, argv, envp);
}

// 8. Intercept posix_spawn() & posix_spawnp() for DPKG maintainer scripts & Clang
int posix_spawn(pid_t *pid, const char *path,
                const posix_spawn_file_actions_t *file_actions,
                const posix_spawnattr_t *attrp,
                char *const argv[], char *const envp[]) {
    if (!real_posix_spawn) real_posix_spawn = dlsym(RTLD_NEXT, "posix_spawn");
    if (!path) return EFAULT;

    const char *target_path = path;
    if (strcmp(path, "/proc/self/exe") == 0) {
        const char *self_exe = getenv("TERMUX_EXEC__PROC_SELF_EXE");
        if (self_exe && *self_exe) target_path = self_exe;
    }

    if (strncmp(target_path, "/system/", 8) == 0 || strncmp(target_path, "/apex/", 6) == 0) {
        return real_posix_spawn(pid, target_path, file_actions, attrp, argv, envp ? envp : environ);
    }

    char abs_target[PATH_MAX];
    to_absolute_path(target_path, abs_target, sizeof(abs_target));

    char resolved_path[PATH_MAX];
    rewrite_path(abs_target, resolved_path, sizeof(resolved_path));

    int fd = open(resolved_path, O_RDONLY | O_CLOEXEC);
    if (fd >= 0) {
        char header[512];
        ssize_t n = read(fd, header, sizeof(header) - 1);
        close(fd);
        if (n > 2 && header[0] == '#' && header[1] == '!') {
            header[n] = 0;
            char *eol = strchr(header, 10);
            if (eol) *eol = 0;
            char *interp = header + 2;
            while (*interp == 32 || *interp == 9) interp++;

            char abs_interp[PATH_MAX];
            to_absolute_path(interp, abs_interp, sizeof(abs_interp));

            char resolved_interp[PATH_MAX];
            rewrite_path(abs_interp, resolved_interp, sizeof(resolved_interp));

            int argc = 0;
            while (argv && argv[argc]) argc++;

            char **new_argv = (char **)malloc((argc + 5) * sizeof(char *));
            new_argv[0] = (argv && argv[0]) ? argv[0] : (char *)LINKER;
            new_argv[1] = resolved_interp;
            new_argv[2] = resolved_path;
            for (int i = 1; i < argc; i++) {
                if (argv[i]) {
                    char *rarg = (char *)malloc(512);
                    rewrite_path(argv[i], rarg, 512);
                    new_argv[i + 2] = rarg;
                }
            }
            new_argv[argc + 2] = NULL;
            char **passed_env = ensure_env(envp, resolved_interp);
            int ret = real_posix_spawn(pid, LINKER, file_actions, attrp, new_argv, passed_env);
            for (int i = 1; i < argc; i++) if (new_argv[i + 2]) free(new_argv[i + 2]);
            free(new_argv);
            return ret;
        }
    }

    int argc = 0;
    while (argv && argv[argc]) argc++;

    char **new_argv = (char **)malloc((argc + 4) * sizeof(char *));
    new_argv[0] = (argv && argv[0]) ? argv[0] : (char *)LINKER;
    new_argv[1] = resolved_path;
    for (int i = 1; i < argc; i++) {
        if (argv[i]) {
            char *rarg = (char *)malloc(512);
            rewrite_path(argv[i], rarg, 512);
            new_argv[i + 1] = rarg;
        }
    }
    new_argv[argc + 1] = NULL;

    char **passed_env = ensure_env(envp, resolved_path);
    int ret = real_posix_spawn(pid, LINKER, file_actions, attrp, new_argv, passed_env);
    for (int i = 1; i < argc; i++) if (new_argv[i + 1]) free(new_argv[i + 1]);
    free(new_argv);
    return ret;
}

int posix_spawnp(pid_t *pid, const char *file,
                 const posix_spawn_file_actions_t *file_actions,
                 const posix_spawnattr_t *attrp,
                 char *const argv[], char *const envp[]) {
    char fullpath[512];
    if (strchr(file, '/')) {
        snprintf(fullpath, sizeof(fullpath), "%s", file);
    } else {
        snprintf(fullpath, sizeof(fullpath), "%s/bin/%s", get_prefix(), file);
    }
    return posix_spawn(pid, fullpath, file_actions, attrp, argv, envp);
}

// 9. Fake root ownership and identity stubs for DPKG & maintainer scripts
int chown(const char *pathname, uid_t owner, gid_t group) { return 0; }
int fchown(int fd, uid_t owner, gid_t group) { return 0; }
int lchown(const char *pathname, uid_t owner, gid_t group) { return 0; }
int fchownat(int dirfd, const char *pathname, uid_t owner, gid_t group, int flags) { return 0; }
int setuid(uid_t uid) { return 0; }
int setgid(gid_t gid) { return 0; }
int setgroups(size_t size, const gid_t *list) { return 0; }
`;

module.exports = function withTermuxNative(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = path.resolve(__dirname, '..');
      const androidAppDir = path.join(projectRoot, 'android', 'app');
      
      const assetsDir = path.join(androidAppDir, 'src', 'main', 'assets');
      const cppDir = path.join(androidAppDir, 'src', 'main', 'cpp');
      const jniLibsArm64 = path.join(androidAppDir, 'src', 'main', 'jniLibs', 'arm64-v8a');

      fs.mkdirSync(assetsDir, { recursive: true });
      fs.mkdirSync(cppDir, { recursive: true });
      fs.mkdirSync(jniLibsArm64, { recursive: true });

      const javaOldDir = path.join(androidAppDir, 'src', 'main', 'java', 'in', 'rocklab', 'federaide', 'terminal');
      if (fs.existsSync(javaOldDir)) {
        fs.rmSync(javaOldDir, { recursive: true, force: true });
      }

      fs.writeFileSync(path.join(cppDir, 'CMakeLists.txt'), CMAKE_LISTS, 'utf8');
      fs.writeFileSync(path.join(cppDir, 'termux.c'), TERMUX_C, 'utf8');
      fs.writeFileSync(path.join(cppDir, 'termux-exec.c'), TERMUX_EXEC_C, 'utf8');

      const rootAssets = ['bootstrap-aarch64.zip', 'install.sh', 'mobile_bridge_termux.py'];
      for (const file of rootAssets) {
        let src = path.join(projectRoot, 'assets', file);
        const dest = path.join(assetsDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          const size = (fs.statSync(dest).size / (1024 * 1024)).toFixed(2);
          console.log(`[withTermuxNative] Copied asset: ${file} (${size} MB) -> ${dest}`);
        }
      }

      // Copy local federate Python module overlay if present
      const federateSrcDir = path.join(projectRoot, 'assets', 'federate');
      const federateDestDir = path.join(assetsDir, 'federate');
      if (fs.existsSync(federateSrcDir)) {
        fs.mkdirSync(federateDestDir, { recursive: true });
        for (const file of fs.readdirSync(federateSrcDir)) {
          if (file.endsWith('.py') || file.endsWith('.json') || file.endsWith('.md')) {
            fs.copyFileSync(path.join(federateSrcDir, file), path.join(federateDestDir, file));
          }
        }
        console.log(`[withTermuxNative] Bundled local federate module overlay into APK assets.`);
      }

      return config;
    },
  ]);

  config = withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    app.$['android:extractNativeLibs'] = 'true';
    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes('externalNativeBuild')) {
      const externalNativeBuildBlock = `
    externalNativeBuild {
        cmake {
            path "src/main/cpp/CMakeLists.txt"
        }
    }
`;
      contents = contents.replace(/android\s*\{/, `android {\n${externalNativeBuildBlock}`);
    }

    if (!contents.includes('useLegacyPackaging')) {
      const packagingBlock = `
    packagingOptions {
        jniLibs {
            useLegacyPackaging true
        }
    }
    androidResources {
        noCompress 'zip', 'so'
    }
    sourceSets {
        main {
            assets.srcDirs += ['src/main/assets']
            jniLibs.srcDirs += ['src/main/jniLibs']
        }
    }
`;
      contents = contents.replace(/android\s*\{/, `android {\n${packagingBlock}`);
    }

    config.modResults.contents = contents;
    return config;
  });

  return config;
};
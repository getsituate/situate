#include <errno.h>
#include <fcntl.h>
#include <jni.h>
#include <limits.h>
#include <linux/fs.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

static int component(JNIEnv *env, jstring value, char output[NAME_MAX + 1]) {
    if (value == NULL) return EINVAL;
    jsize length = (*env)->GetStringLength(env, value);
    if (length == 0 || length > NAME_MAX) return EINVAL;
    jchar chars[NAME_MAX];
    (*env)->GetStringRegion(env, value, 0, length, chars);
    if ((*env)->ExceptionCheck(env)) return EINVAL;
    for (jsize i = 0; i < length; i++) {
        jchar c = chars[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_')) {
            return EINVAL;
        }
        output[i] = (char)c;
    }
    output[length] = '\0';
    if (strcmp(output, ".") == 0 || strcmp(output, "..") == 0) return EINVAL;
    return 0;
}

JNIEXPORT jint JNICALL
Java_dev_situate_access_WorkspacePublication_renameNoReplace(
    JNIEnv *env, jobject self, jint directory_fd, jstring source, jstring target) {
    (void)self;
    char source_name[NAME_MAX + 1];
    char target_name[NAME_MAX + 1];
    int error = component(env, source, source_name);
    if (error != 0) return error;
    error = component(env, target, target_name);
    if (error != 0) return error;
    if (strcmp(source_name, target_name) == 0) return EINVAL;
    if (directory_fd < 0) return EBADF;
    struct stat directory;
    if (fstat(directory_fd, &directory) != 0) return errno;
    if (!S_ISDIR(directory.st_mode)) return ENOTDIR;
    struct stat staged;
    if (fstatat(directory_fd, source_name, &staged, AT_SYMLINK_NOFOLLOW) != 0) return errno;
    if (!S_ISREG(staged.st_mode)) return EINVAL;

    // The libc wrapper requires API 30, but AOSP's app seccomp policies allow
    // renameat2 since their introduction in Android O, including all four ABIs.
    // Android Q: platform/bionic libc/SECCOMP_WHITELIST_COMMON.TXT.
    // Kernel/filesystem errors must not trigger an overwriting fallback.
#ifdef SYS_renameat2
    if (syscall(SYS_renameat2, directory_fd, source_name, directory_fd, target_name,
                RENAME_NOREPLACE) != 0) return errno;
    return 0;
#else
    return ENOSYS;
#endif
}

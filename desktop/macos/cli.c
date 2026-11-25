#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    (void)argc;
    char path[PATH_MAX];
    uint32_t size = sizeof(path);
    if (_NSGetExecutablePath(path, &size) != 0) return 1;
    char *slash = strrchr(path, '/');
    if (!slash) return 1;
    *slash = '\0';
    const char *suffix = "/../Resources/runtime/studio";
    if (strlen(path) + strlen(suffix) >= sizeof(path)) return 1;
    strcat(path, suffix);
    argv[0] = path;
    execv(path, argv);
    perror("Cannot start Project Studio CLI");
    return 1;
}

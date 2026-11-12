#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <unistd.h>

typedef void (*GetPlaying)(dispatch_queue_t, void (^)(bool));
typedef void (*GetPID)(dispatch_queue_t, void (^)(int));
typedef bool (*SendCommand)(int, CFDictionaryRef);

// MediaRemote restricts ordinary app processes on recent macOS versions. This
// entry point is loaded by the system Perl executable, not linked into the app.
// Technique: https://github.com/ungive/mediaremote-adapter
void situate_media_command(void) {
    @autoreleasepool {
        void *framework = dlopen(
            "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_LAZY);
        if (!framework) exit(2);
        GetPlaying getPlaying = (GetPlaying)dlsym(framework, "MRMediaRemoteGetNowPlayingApplicationIsPlaying");
        GetPID getPID = (GetPID)dlsym(framework, "MRMediaRemoteGetNowPlayingApplicationPID");
        SendCommand send = (SendCommand)dlsym(framework, "MRMediaRemoteSendCommand");
        if (!getPlaying || !getPID || !send) exit(2);

        dispatch_queue_t queue = dispatch_queue_create("dev.situate.media.state", DISPATCH_QUEUE_SERIAL);
        dispatch_group_t group = dispatch_group_create();
        __block bool playing = false;
        __block int pid = 0;
        dispatch_group_enter(group);
        getPlaying(queue, ^(bool value) {
            playing = value;
            dispatch_group_leave(group);
        });
        dispatch_group_enter(group);
        getPID(queue, ^(int value) {
            pid = value;
            dispatch_group_leave(group);
        });
        if (dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) != 0) exit(2);

        NSString *action = NSProcessInfo.processInfo.environment[@"SITUATE_MEDIA_ACTION"];
        int expected = [NSProcessInfo.processInfo.environment[@"SITUATE_MEDIA_PID"] intValue];
        if ([action isEqualToString:@"pause"]) {
            if (pid > 0 && playing && send(1, NULL)) {
                usleep(100000);
                printf("%d\n", pid);
            } else {
                puts("0");
            }
        } else if ([action isEqualToString:@"resume"]) {
            // Never start previously paused media or resume a different Now Playing session.
            if (expected > 0 && pid == expected && !playing) {
                if (!send(0, NULL)) exit(2);
                usleep(100000);
            }
            puts("0");
        } else if ([action isEqualToString:@"status"]) {
            printf("%d %d\n", pid, playing);
        } else {
            exit(2);
        }
        fflush(stdout);
        exit(0);
    }
}

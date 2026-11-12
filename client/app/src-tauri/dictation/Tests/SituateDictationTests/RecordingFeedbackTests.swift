import Foundation
import Testing

@testable import SituateDictation

@Test func microphoneLevelsHaveAFixedFloorAndPreserveLoudness() {
    #expect(dictationLevel(decibels: -160) == 0)
    #expect(dictationLevel(decibels: -55) == 0)
    #expect(dictationLevel(decibels: -27.5) == 0.5)
    #expect(dictationLevel(decibels: 0) == 1)
    #expect(dictationLevel(decibels: 5) == 1)
    #expect(dictationLevel(decibels: .nan) == 0)
    #expect(dictationLevel(decibels: .infinity) == 0)
}

@MainActor
@Test func restoresOnlyASuccessfullyOwnedPauseOnce() async {
    var commands: [String] = []
    let media = SystemMediaInterruption { action, pid in
        commands.append("\(action):\(pid)")
        return action == "pause" ? 42 : 0
    }
    await media.begin("first")
    media.end("stale")
    media.end("first")
    media.end("first")
    await media.settle()
    #expect(commands == ["pause:0", "resume:42"])
}

@MainActor
@Test func previouslyPausedOrUnavailableMediaIsNotResumed() async {
    for result: Int32? in [0, nil] {
        var commands: [String] = []
        let media = SystemMediaInterruption { action, _ in
            commands.append(action)
            return result
        }
        await media.begin("first")
        media.end("first")
        await media.settle()
        #expect(commands == ["pause"])
    }
}

@MainActor
@Test func cancellationWhilePausingRestoresBeforeTheNextRecording() async {
    var release: CheckedContinuation<Int32?, Never>?
    var started: CheckedContinuation<Void, Never>?
    var commands: [String] = []
    let media = SystemMediaInterruption { action, pid in
        commands.append("\(action):\(pid)")
        if commands.count == 1 {
            return await withCheckedContinuation { continuation in
                release = continuation
                started?.resume()
            }
        }
        return action == "pause" ? 84 : 0
    }
    let first = Task { await media.begin("first") }
    await withCheckedContinuation { continuation in
        if release != nil { continuation.resume() } else { started = continuation }
    }
    media.end("first")
    let second = Task { await media.begin("second") }
    release?.resume(returning: 42)
    await first.value
    await second.value
    media.end("second")
    await media.settle()
    #expect(commands == ["pause:0", "resume:42", "pause:0", "resume:84"])
}

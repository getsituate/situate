import AVFoundation
import AppKit
import FluidAudio
import Foundation
import Network

private func cancellableWork<T: Sendable>(_ work: @escaping @Sendable () async throws -> T)
    async throws -> T
{
    let task = Task.detached(operation: work)
    return try await withTaskCancellationHandler {
        try await task.value
    } onCancel: {
        task.cancel()
    }
}

func isStorageFailure(_ error: NSError) -> Bool {
    if error.domain == NSCocoaErrorDomain && error.code == NSFileWriteOutOfSpaceError {
        return true
    }
    if error.domain == NSPOSIXErrorDomain && error.code == POSIXErrorCode.ENOSPC.rawValue {
        return true
    }
    if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError {
        return isStorageFailure(underlying)
    }
    return false
}

func dictationLevel(decibels: Float) -> Float {
    guard decibels.isFinite else { return 0 }
    // A fixed floor preserves the difference between quiet and loud speech.
    return min(1, max(0, (decibels + 55) / 55))
}

@MainActor
func dictationMicrophoneAccess(
    requestAccess: () async -> Bool,
    isActive: () -> Bool,
    notifications: NotificationCenter = .default
) async throws -> Bool {
    try Task.checkCancellation()
    let activations = notifications.notifications(named: NSApplication.didBecomeActiveNotification)
        .map { _ in () }
    let allowed = await requestAccess()
    try Task.checkCancellation()
    guard allowed else { return false }
    if isActive() { return true }
    for await _ in activations {
        try Task.checkCancellation()
        if isActive() { return true }
    }
    throw CancellationError()
}

public typealias DictationCallback = @convention(c) @Sendable (UnsafePointer<CChar>) -> Void

@MainActor
final class Dictation: NSObject, AVAudioRecorderDelegate {
    static let shared = Dictation()
    var callback: DictationCallback?
    private var directory: URL?
    private var source = ModelSource.huggingFace
    private var monitor: NWPathMonitor?
    private var eligible = false
    private var provisioning: Task<Void, Never>?
    private var recognition: Task<Void, Never>?
    private var starting: Task<Void, Never>?
    private var manager: AsrManager?
    private var recorder: AVAudioRecorder?
    private var metering: Task<Void, Never>?
    private var media: SystemMediaInterruption?
    private var operation: String?
    private var phase = "idle"
    private var discarding = false
    private var observers: [NSObjectProtocol] = []

    func emit(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event),
            let text = String(data: data, encoding: .utf8)
        else { return }
        text.withCString { callback?($0) }
    }

    func setup(
        _ path: String, library: String, loader: String, source: ModelSource,
        callback: @escaping DictationCallback
    ) {
        guard directory == nil else { return }
        self.callback = callback
        self.source = source
        let transport = MacSystemMedia(library: library, loader: loader)
        media = SystemMediaInterruption { action, pid in
            await transport.command(action, pid: pid)
        }
        AppLogger.minimumLevel = .fault
        AppLogger.mirrorsToConsole = false
        let directory = URL(fileURLWithPath: path, isDirectory: true)
        self.directory = directory
        do {
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            var excluded = directory
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try excluded.setResourceValues(values)
            let audio = directory.appendingPathComponent("recording.caf")
            if FileManager.default.fileExists(atPath: audio.path) {
                try FileManager.default.removeItem(at: audio)
            }
        } catch {
            emit(["model": isStorageFailure(error as NSError) ? "storage" : "failed"])
            return
        }
        if source.requiresNetwork {
            let monitor = NWPathMonitor()
            self.monitor = monitor
            monitor.pathUpdateHandler = { path in
                // Tethered Wi-Fi/Ethernet exposes the local interface, not its upstream transport.
                let allowed =
                    path.status == .satisfied && !path.usesInterfaceType(.cellular)
                    && (path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet))
                Task { @MainActor in
                    self.eligible = allowed
                    if !allowed {
                        self.provisioning?.cancel()
                    } else if self.manager == nil && self.provisioning == nil {
                        self.provision()
                    }
                }
            }
            monitor.start(queue: DispatchQueue(label: "dev.situate.dictation.network"))
        }
        for (center, name) in [
            (NotificationCenter.default, NSApplication.didResignActiveNotification),
            (NSWorkspace.shared.notificationCenter, NSWorkspace.sessionDidResignActiveNotification),
            (NSWorkspace.shared.notificationCenter, NSWorkspace.willSleepNotification),
            (NSWorkspace.shared.notificationCenter, NSWorkspace.screensDidSleepNotification),
        ] {
            observers.append(
                center.addObserver(forName: name, object: nil, queue: .main) { _ in
                    MainActor.assumeIsolated {
                        if self.phase == "recording" { self.discard(notice: "interrupted") }
                    }
                })
        }
        provision()
    }

    func provision() {
        guard provisioning == nil, manager == nil, let directory else { return }
        emit(["model": "checking"])
        let eligible = self.eligible
        let source = self.source
        provisioning = Task {
            do {
                let models = try await cancellableWork {
                    let modelDirectory = directory.appendingPathComponent(ModelManifest.revision)
                    let total = ModelManifest.files.reduce(Int64(0)) { $0 + $1.size }
                    var complete: Int64 = 0
                    for file in ModelManifest.files {
                        let url = modelDirectory.appendingPathComponent(file.path)
                        let base = complete
                        try await source.provision(file, to: url, networkAvailable: eligible) {
                            bytes in
                            Task { @MainActor in
                                self.emit([
                                    "model": "downloading",
                                    "progress": Int(100 * (base + bytes) / total),
                                ])
                            }
                        }
                        complete += file.size
                    }
                    await self.emit(["model": "preparing"])
                    return try AsrModels.loadLocal(from: modelDirectory, version: .v3)
                }
                manager = AsrManager(models: models)
                emit(["model": "ready", "progress": 100])
            } catch {
                let cancelled = error is CancellationError
                let error = error as NSError
                let waiting =
                    (source.requiresNetwork && !self.eligible)
                    || error.code == NSURLErrorCancelled || cancelled
                emit([
                    "model": waiting
                        ? "waiting"
                        : isStorageFailure(error) ? "storage" : "failed"
                ])
            }
            provisioning = nil
            if self.eligible && manager == nil && (!eligible || Task.isCancelled) { provision() }
        }
    }

    func start(_ id: String) {
        guard operation == nil, manager != nil, directory != nil else {
            emit(["id": id, "phase": "finished", "notice": "failed"])
            return
        }
        operation = id
        phase = "permission"
        emit(["id": id, "phase": phase])
        starting = Task {
            do {
                let allowed = try await dictationMicrophoneAccess(
                    requestAccess: { await AVCaptureDevice.requestAccess(for: .audio) },
                    isActive: { NSApplication.shared.isActive })
                guard operation == id, phase == "permission" else { return }
                guard allowed else {
                    finish(id, notice: "denied")
                    return
                }
                let url = directory!.appendingPathComponent("recording.caf")
                let recorder = try AVAudioRecorder(
                    url: url,
                    settings: [
                        AVFormatIDKey: kAudioFormatLinearPCM,
                        AVSampleRateKey: 16000,
                        AVNumberOfChannelsKey: 1,
                        AVLinearPCMBitDepthKey: 16,
                        AVLinearPCMIsFloatKey: false,
                        AVLinearPCMIsBigEndianKey: false,
                    ])
                await media?.begin(id)
                guard operation == id, phase == "permission" else { return }
                guard NSApplication.shared.isActive else {
                    finish(id, notice: "interrupted")
                    return
                }
                self.recorder = recorder
                recorder.delegate = self
                recorder.isMeteringEnabled = true
                guard recorder.record() else { throw CocoaError(.fileWriteUnknown) }
                phase = "recording"
                emit(["id": id, "phase": phase])
                metering = Task {
                    while !Task.isCancelled, self.operation == id, self.phase == "recording" {
                        recorder.updateMeters()
                        self.emit([
                            "id": id,
                            "level": dictationLevel(decibels: recorder.averagePower(forChannel: 0)),
                        ])
                        do { try await Task.sleep(for: .milliseconds(50)) } catch { break }
                    }
                }
            } catch { finish(id, notice: "failed") }
        }
    }

    func stop(_ id: String) {
        guard operation == id, phase == "recording", let recorder, let manager else { return }
        recorder.stop()
        self.recorder = nil
        releaseRecording(id)
        phase = "transcribing"
        emit(["id": id, "phase": phase])
        let url = recorder.url
        recognition = Task {
            do {
                let text = try await cancellableWork {
                    let file = try AVAudioFile(forReading: url)
                    guard
                        file.length
                            >= ASRConstants.minimumRequiredSamples(
                                forSampleRate: Int(file.processingFormat.sampleRate))
                    else { return "" }
                    guard file.length <= Int64(UInt32.max),
                        let buffer = AVAudioPCMBuffer(
                            pcmFormat: file.processingFormat,
                            frameCapacity: AVAudioFrameCount(file.length))
                    else { throw CocoaError(.fileReadTooLarge) }
                    try file.read(into: buffer)
                    var decoder = try TdtDecoderState()
                    return try await manager.transcribe(buffer, decoderState: &decoder).text
                }.trimmingCharacters(in: .whitespacesAndNewlines)
                guard operation == id else { return }
                if discarding {
                    finish(id)
                } else {
                    finish(id, notice: text.isEmpty ? "noSpeech" : nil, text: text)
                }
            } catch {
                if operation == id { finish(id, notice: discarding ? nil : "failed") }
            }
            recognition = nil
        }
    }

    func discard(_ expectedId: String? = nil, notice: String? = nil) {
        guard let id = operation, expectedId == nil || expectedId == id else { return }
        if phase == "transcribing" {
            discarding = true
            recognition?.cancel()
        } else {
            finish(id, notice: notice)
        }
    }

    private func releaseRecording(_ id: String) {
        metering?.cancel()
        metering = nil
        media?.end(id)
    }

    private func finish(_ id: String, notice: String? = nil, text: String? = nil) {
        guard operation == id, phase != "finishing" else { return }
        starting?.cancel()
        starting = nil
        recorder?.stop()
        releaseRecording(id)
        recorder = nil
        phase = "finishing"
        discarding = false
        var event: [String: Any] = ["id": id, "phase": "finished"]
        if let notice { event["notice"] = notice }
        if let text { event["text"] = text }
        if let url = directory?.appendingPathComponent("recording.caf"),
            FileManager.default.fileExists(atPath: url.path)
        {
            do { try FileManager.default.removeItem(at: url) } catch {
                event.removeValue(forKey: "text")
                event["notice"] = "failed"
            }
        }
        Task {
            await media?.settle()
            operation = nil
            phase = "idle"
            emit(event)
        }
    }

    nonisolated func audioRecorderDidFinishRecording(
        _ recorder: AVAudioRecorder, successfully flag: Bool
    ) {
        Task { @MainActor in
            if self.recorder === recorder && self.phase == "recording" {
                self.discard(notice: "interrupted")
            }
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor in if self.recorder === recorder { self.discard(notice: "interrupted") } }
    }
}

@_cdecl("situate_dictation_setup")
public func setupDictation(
    _ path: UnsafePointer<CChar>, _ library: UnsafePointer<CChar>,
    _ loader: UnsafePointer<CChar>, _ source: UnsafePointer<CChar>,
    _ callback: @escaping DictationCallback
) {
    let path = String(cString: path)
    let library = String(cString: library)
    let loader = String(cString: loader)
    let source = String(cString: source)
    let modelSource: ModelSource =
        source.isEmpty ? .huggingFace : .local(URL(fileURLWithPath: source, isDirectory: true))
    Task { @MainActor in
        Dictation.shared.setup(
            path, library: library, loader: loader, source: modelSource, callback: callback)
    }
}

@_cdecl("situate_dictation_command")
public func commandDictation(_ command: UnsafePointer<CChar>, _ id: UnsafePointer<CChar>) {
    let command = String(cString: command)
    let id = String(cString: id)
    Task { @MainActor in
        switch command {
        case "start": Dictation.shared.start(id)
        case "stop": Dictation.shared.stop(id)
        case "discard": Dictation.shared.discard(id)
        case "retry": Dictation.shared.provision()
        default: break
        }
    }
}

import AVFoundation
import FluidAudio
import Foundation
import Testing

@testable import SituateDictation

@Test(.enabled(if: ProcessInfo.processInfo.environment["SITUATE_DICTATION_FIXTURE"] != nil))
func recognizesGermanAndEnglishWithoutLanguageHints() async throws {
    let root = URL(
        fileURLWithPath: ProcessInfo.processInfo.environment["SITUATE_DICTATION_FIXTURE"]!)
    AppLogger.minimumLevel = .fault
    AppLogger.mirrorsToConsole = false
    let models = try loadDictationModels(from: root.appendingPathComponent("model"))
    let manager = AsrManager(models: models)
    for (name, expected) in [("english", "notebook"), ("german", "notizbuch")] {
        let result = try await transcribe(
            root.appendingPathComponent("\(name).aiff"), using: manager)
        #expect(result.lowercased().contains(expected))
    }
}

@Test(
    .enabled(if: ProcessInfo.processInfo.environment["SITUATE_DICTATION_DOWNLOAD_FIXTURE"] == "1"))
func recognizesSyntheticSpeechWithPinnedModel() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(
        at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }

    let audio = root.appendingPathComponent("english.aiff")
    let say = Process()
    say.executableURL = URL(fileURLWithPath: "/usr/bin/say")
    say.arguments = ["-v", "Samantha", "-o", audio.path, "Please write this down in my notebook."]
    try say.run()
    say.waitUntilExit()
    try #require(say.terminationStatus == 0)

    let models = root.appendingPathComponent("model")
    for file in ModelManifest.files {
        try await ModelSource.huggingFace.provision(
            file, to: models.appendingPathComponent(file.path), networkAvailable: true,
            progress: { _ in })
    }
    AppLogger.minimumLevel = .fault
    AppLogger.mirrorsToConsole = false
    let manager = AsrManager(models: try loadDictationModels(from: models))
    let result = try await transcribe(audio, using: manager)
    #expect(result.lowercased().contains("notebook"))
}

private func transcribe(_ url: URL, using manager: AsrManager) async throws -> String {
    let file = try AVAudioFile(forReading: url)
    let buffer = try #require(
        AVAudioPCMBuffer(
            pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)))
    try file.read(into: buffer)
    var decoder = try TdtDecoderState()
    return try await manager.transcribe(buffer, decoderState: &decoder).text
}

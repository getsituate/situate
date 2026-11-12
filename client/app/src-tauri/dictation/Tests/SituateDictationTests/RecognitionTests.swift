import AVFoundation
import FluidAudio
import Foundation
import Testing

@Test(.enabled(if: ProcessInfo.processInfo.environment["SITUATE_DICTATION_FIXTURE"] != nil))
func recognizesGermanAndEnglishWithoutLanguageHints() async throws {
    let root = URL(
        fileURLWithPath: ProcessInfo.processInfo.environment["SITUATE_DICTATION_FIXTURE"]!)
    AppLogger.minimumLevel = .fault
    AppLogger.mirrorsToConsole = false
    let models = try AsrModels.loadLocal(from: root.appendingPathComponent("model"), version: .v3)
    let manager = AsrManager(models: models)
    for (name, expected) in [("english", "notebook"), ("german", "notizbuch")] {
        let file = try AVAudioFile(forReading: root.appendingPathComponent("\(name).aiff"))
        let buffer = try #require(
            AVAudioPCMBuffer(
                pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)))
        try file.read(into: buffer)
        var decoder = try TdtDecoderState()
        let result = try await manager.transcribe(buffer, decoderState: &decoder)
        #expect(result.text.lowercased().contains(expected))
    }
}

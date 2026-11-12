import Foundation

@MainActor
final class SystemMediaInterruption {
    private var recording: String?
    private var paused: (id: String, pid: Int32)?
    private var pending: Task<Void, Never>?
    private let command: (String, Int32) async -> Int32?

    init(command: @escaping (String, Int32) async -> Int32?) {
        self.command = command
    }

    func begin(_ id: String) async {
        recording = id
        let previous = pending
        let task = Task {
            await previous?.value
            guard self.recording == id else { return }
            guard let pid = await self.command("pause", 0), pid > 0 else { return }
            if self.recording == id {
                self.paused = (id, pid)
            } else {
                _ = await self.command("resume", pid)
            }
        }
        pending = task
        await task.value
    }

    func end(_ id: String) {
        guard recording == id else { return }
        recording = nil
        let previous = pending
        pending = Task {
            await previous?.value
            guard let paused = self.paused, paused.id == id else { return }
            self.paused = nil
            _ = await self.command("resume", paused.pid)
        }
    }

    func settle() async {
        await pending?.value
    }
}

struct MacSystemMedia: Sendable {
    let library: String
    let loader: String

    func command(_ action: String, pid: Int32) async -> Int32? {
        await Task.detached {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
            process.arguments = [loader, library, action, String(pid)]
            process.environment = ["PATH": "/usr/bin:/bin", "LC_ALL": "C"]
            let output = Pipe()
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            do {
                try process.run()
            } catch {
                return nil
            }
            let timeout = DispatchSource.makeTimerSource()
            timeout.schedule(deadline: .now() + 3)
            timeout.setEventHandler { if process.isRunning { process.terminate() } }
            timeout.resume()
            process.waitUntilExit()
            timeout.cancel()
            guard process.terminationStatus == 0 else { return nil }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            guard let text = String(data: data, encoding: .utf8) else { return nil }
            return Int32(text.trimmingCharacters(in: .whitespacesAndNewlines))
        }.value
    }
}

import AppKit
import Foundation
import Testing

@testable import SituateDictation

@MainActor
@Test func grantedPermissionWaitsForApplicationActivation() async throws {
    let notifications = NotificationCenter()
    var active = false
    var completed = false
    var waiting: CheckedContinuation<Void, Never>?
    let task = Task {
        let allowed = try await dictationMicrophoneAccess(
            requestAccess: { true },
            isActive: {
                waiting?.resume()
                waiting = nil
                return active
            }, notifications: notifications)
        completed = true
        return allowed
    }
    await withCheckedContinuation { waiting = $0 }
    #expect(!completed)
    active = true
    notifications.post(name: NSApplication.didBecomeActiveNotification, object: nil)
    #expect(try await task.value)
    #expect(completed)
}

@MainActor
@Test func permissionCompletesWithoutWaitingWhenApplicationIsAlreadyActive() async throws {
    #expect(
        try await dictationMicrophoneAccess(
            requestAccess: { true }, isActive: { true }, notifications: NotificationCenter()))
}

@MainActor
@Test func deniedPermissionDoesNotWaitForApplicationActivation() async throws {
    #expect(
        try await !dictationMicrophoneAccess(
            requestAccess: { false }, isActive: { false }, notifications: NotificationCenter()))
}

@MainActor
@Test func discardingWhileWaitingForActivationCancelsTheStart() async {
    let notifications = NotificationCenter()
    var waiting: CheckedContinuation<Void, Never>?
    let task = Task {
        try await dictationMicrophoneAccess(
            requestAccess: { true },
            isActive: {
                waiting?.resume()
                waiting = nil
                return false
            }, notifications: notifications)
    }
    await withCheckedContinuation { waiting = $0 }
    task.cancel()
    do {
        _ = try await task.value
        Issue.record("Cancelled dictation must not start recording")
    } catch {
        #expect(error is CancellationError)
    }
}

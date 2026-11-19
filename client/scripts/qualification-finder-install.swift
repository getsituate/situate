import AppKit
import ApplicationServices

func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
}

guard CommandLine.arguments.count == 3 else { exit(1) }
let fm = FileManager.default
let source = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let folder = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let installed = folder.appendingPathComponent("Situate.app")
guard source.lastPathComponent == installed.lastPathComponent,
    source.resolvingSymlinksInPath().path == source.path,
    source.deletingLastPathComponent().deletingLastPathComponent() == folder,
    source.deletingLastPathComponent().lastPathComponent.hasPrefix("downloaded-"),
    folder.lastPathComponent.hasPrefix("situate-final-artifact-"),
    folder.resolvingSymlinksInPath().path == folder.path, fm.fileExists(atPath: source.path),
    !fm.fileExists(atPath: installed.path),
    AXIsProcessTrusted(),
    NSRunningApplication.runningApplications(withBundleIdentifier: "com.getsituate.app").isEmpty
else {
    print("precondition")
    exit(1)
}
let folders = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder")
guard folders.count == 1, let finder = folders.first,
    finder.bundleURL?.path == "/System/Library/CoreServices/Finder.app"
else { exit(1) }
let e = AXUIElementCreateApplication(finder.processIdentifier)
AXUIElementSetMessagingTimeout(e, 0.5)
let pb = NSPasteboard.general
let before = pb.changeCount
var ownedClipboard: Int?
func send(_ code: CGKeyCode, flags: CGEventFlags) -> Bool {
    guard !finder.isTerminated else { return false }
    for down in [true, false] {
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else {
            return false
        }
        event.flags = flags
        event.postToPid(finder.processIdentifier)
    }
    return true
}
func focused(_ name: String) -> Bool {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == finder.processIdentifier,
        let windows = attr(e, kAXWindowsAttribute) as? [AXUIElement], windows.count <= 16,
        let window = windows.first
    else { return false }
    let matching = windows.filter { attr($0, kAXTitleAttribute) as? String == name }
    return matching.count == 1 && CFEqual(window, matching[0])
}
func ready(_ name: String) -> Bool {
    for _ in 0..<20 {
        if focused(name) { return true }
        Thread.sleep(forTimeInterval: 0.1)
    }
    return false
}
func move() -> String {
    defer {
        if let ownedClipboard, pb.changeCount == ownedClipboard {
            pb.clearContents()
        }
    }
    NSWorkspace.shared.activateFileViewerSelecting([source])
    guard ready(source.deletingLastPathComponent().lastPathComponent),
        send(8, flags: .maskCommand)
    else { return "source-window" }
    for _ in 0..<10 {
        let generation = pb.changeCount
        if generation != before,
            let item = pb.readObjects(
                forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL],
            item.count == 1, item[0].path == source.path, pb.changeCount == generation
        {
            ownedClipboard = generation
            break
        }
        Thread.sleep(forTimeInterval: 0.1)
    }
    guard let ownedClipboard else { return "not-copied" }
    guard NSWorkspace.shared.open(folder), ready(folder.lastPathComponent),
        !fm.fileExists(atPath: installed.path), fm.fileExists(atPath: source.path),
        pb.changeCount == ownedClipboard
    else { return "destination-window" }
    // Finder records a user move. A filesystem rename leaves the app translocated.
    guard send(9, flags: [.maskCommand, .maskAlternate]) else { return "move-uncertain" }
    for _ in 0..<20 {
        if !fm.fileExists(atPath: source.path) && fm.fileExists(atPath: installed.path) {
            return "moved"
        }
        Thread.sleep(forTimeInterval: 0.1)
    }
    return "move-uncertain"
}
print(move())

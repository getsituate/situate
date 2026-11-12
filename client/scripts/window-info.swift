import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2, let pid = Int32(CommandLine.arguments[1]) else {
    fputs("Usage: window-info <pid>\n", stderr)
    exit(2)
}
let windows =
    CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
let selected = windows.filter {
    ($0[kCGWindowOwnerPID as String] as? Int32) == pid
        && ($0[kCGWindowLayer as String] as? Int) == 0
}.compactMap { window -> [String: Any]? in
    guard let id = window[kCGWindowNumber as String] as? Int,
        let bounds = window[kCGWindowBounds as String] as? [String: Any],
        let width = bounds["Width"] as? Double, width >= 200,
        let height = bounds["Height"] as? Double, height >= 200
    else { return nil }
    return ["id": id, "width": width, "height": height]
}
let data = try JSONSerialization.data(withJSONObject: selected)
print(String(decoding: data, as: UTF8.self))

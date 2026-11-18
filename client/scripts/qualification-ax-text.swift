import ApplicationServices
import Foundation

guard CommandLine.arguments.count == 4, let pid = Int32(CommandLine.arguments[1]), pid > 1 else {
    exit(2)
}
let expected = CommandLine.arguments[2]
let windowName = CommandLine.arguments[3]

func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var result: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(element, key as CFString, &result)
    switch status {
    case .success: return result
    case .noValue, .attributeUnsupported: return nil
    default:
        print("blocked-\(key)-\(status.rawValue)")
        exit(0)
    }
}

let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 0.5)
guard let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement], windows.count <= 16
else {
    print("blocked-window-list")
    exit(0)
}
var pending = windows.filter { (attribute($0, kAXTitleAttribute) as? String) == windowName }
if pending.isEmpty {
    print("unmatched")
    exit(0)
}
guard pending.count == 1 else { exit(2) }

var seen = Set<AXUIElement>()
var matches = 0
while let node = pending.popLast() {
    guard seen.insert(node).inserted else { continue }
    guard seen.count <= 1024 else { exit(2) }
    if attribute(node, kAXRoleAttribute) as? String == kAXStaticTextRole,
        [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute].contains(where: {
            (attribute(node, $0) as? String) == expected
        })
    {
        matches += 1
        if matches > 1 { break }
    }
    if let children = attribute(node, kAXChildrenAttribute) as? [AXUIElement] {
        guard pending.count + children.count <= 1024 else { exit(2) }
        pending.append(contentsOf: children)
    }
}
print(matches == 1 ? "matched" : "unmatched")

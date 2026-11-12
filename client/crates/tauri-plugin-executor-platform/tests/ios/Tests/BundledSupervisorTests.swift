import XCTest

@testable import ExecutorHarness

@MainActor
final class BundledSupervisorTests: XCTestCase {
    private var observe: ([String: Any]) -> Void = { _ in }

    private func load(_ generation: Int, _ service: String) -> [String: Any] {
        [
            "type": "load", "generation": generation, "pluginId": "fixture",
            "source": [
                "manifest": [
                    "schemaVersion": 2, "id": "fixture", "name": "Fixture",
                    "description": "Fixture", "skills": [], "serviceEntry": "service.js",
                ],
                "serviceEntry": service, "uiEntry": NSNull(),
                "modules": ["lib.js": "export const value = 42;"], "skills": [],
            ],
        ]
    }

    private func exchange(
        _ executor: ExecutorWebView, _ command: [String: Any], type: String, generation: Int
    ) throws -> [String: Any] {
        let received = expectation(description: "\(type):\(generation)")
        var result: [String: Any] = [:]
        observe = { event in
            guard event["kind"] as? String == "message",
                let payload = event["payload"] as? [String: Any]
            else { return }
            XCTAssertEqual(payload["type"] as? String, type, "\(payload)")
            XCTAssertEqual(payload["generation"] as? Int, generation)
            result = payload
            received.fulfill()
        }
        let data = try JSONSerialization.data(withJSONObject: command)
        let json = String(decoding: data, as: UTF8.self)
        executor.send(script: "globalThis.__situateReceive(\(json))") { XCTAssertTrue($0) }
        wait(for: [received], timeout: 15)
        return result
    }

    func testShippedModuleWorkerGraphAndAllSynchronousLoopKinds() throws {
        guard let url = Bundle(for: Self.self).url(forResource: "bundled", withExtension: "html")
        else {
            throw XCTSkip("Generate bundled.html with the shipped supervisor artifact.")
        }
        let ready = expectation(description: "shipped supervisor loaded")
        observe = { event in
            if event["kind"] as? String == "ready" { ready.fulfill() }
        }
        let executor = ExecutorWebView(html: try String(contentsOf: url)) { [weak self] event in
            self?.observe(event)
        }
        defer { executor.close() }
        wait(for: [ready], timeout: 15)
        XCTAssertNil(executor.webView?.superview)
        let service = """
            import {value} from './lib.js';
            export default () => ({
              exports:{answer:(args,context)=>({value:value + args.offset,invocationId:context.invocationId})},
              tools:[{name:'loop',description:'Loop',parameters:{type:'object'},execute(_args,context){context.progress('entered');for(;;){}}}]
            });
            """
        let loaded = try exchange(executor, load(1, service), type: "ready", generation: 1)
        XCTAssertEqual(loaded["exports"] as? [String], ["answer"])
        let result = try exchange(
            executor,
            [
                "type": "invoke", "generation": 1, "invocationId": "native-probe",
                "kind": "export", "name": "answer", "args": ["offset": 0],
            ], type: "result", generation: 1)
        let value = try XCTUnwrap(result["result"] as? [String: Any])
        XCTAssertEqual(value["value"] as? Int, 42)
        XCTAssertEqual(value["invocationId"] as? String, "native-probe")
        _ = try exchange(
            executor, ["type": "terminate", "generation": 1], type: "terminated", generation: 1)

        _ = try exchange(
            executor,
            load(2, "postMessage({type:'ready',generation:2,tools:[],exports:[]});for(;;){}"),
            type: "ready", generation: 2)
        _ = try exchange(
            executor, ["type": "terminate", "generation": 2], type: "terminated", generation: 2)

        for (generation, kind) in [(3, "tool"), (4, "check")] {
            _ = try exchange(
                executor, load(generation, service), type: "ready", generation: generation)
            let entered = try exchange(
                executor,
                [
                    "type": "invoke", "generation": generation, "invocationId": "loop",
                    "kind": kind, "name": "loop", "args": [:],
                    "script": "host.progress('entered');for(;;){}",
                ], type: "progress", generation: generation)
            XCTAssertEqual(entered["value"] as? String, "entered")
            _ = try exchange(
                executor, ["type": "terminate", "generation": generation],
                type: "terminated", generation: generation)
        }
        executor.close()
        XCTAssertNil(executor.webView)
    }
}

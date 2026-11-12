import XCTest

final class LifecycleTests: XCTestCase {
    private func start(_ app: XCUIApplication) {
        app.launch()
        app.buttons["start"].tap()
        let proceed = app.alerts.buttons["Continue"]
        if proceed.waitForExistence(timeout: 5) { proceed.tap() }
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if system.alerts.buttons["Continue"].waitForExistence(timeout: 2) {
            system.alerts.buttons["Continue"].tap()
        }
    }

    func testDelayedRustLoopbackWhileSystemAuthenticationIsVisible() {
        let app = XCUIApplication()
        start(app)
        XCTAssertTrue(app.staticTexts["Synthetic delayed sign-in"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Passed delayed Rust loopback"].waitForExistence(timeout: 55))
    }

    func testSystemBrowserCancellationIsNotSuccess() {
        let app = XCUIApplication()
        start(app)
        XCTAssertTrue(app.staticTexts["Synthetic delayed sign-in"].waitForExistence(timeout: 10))
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Cancelled"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Passed delayed Rust loopback"].exists)
    }

    func testSyntheticKeychainRoundtripInIsolatedAppBundle() {
        let app = XCUIApplication()
        app.launch()
        app.buttons["keychain"].tap()
        XCTAssertTrue(
            app.staticTexts["Passed isolated Keychain roundtrip"].waitForExistence(timeout: 10),
            app.staticTexts["status"].label)
    }
}

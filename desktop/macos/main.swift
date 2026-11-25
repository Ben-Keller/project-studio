import Cocoa
import WebKit
import Darwin
import Sparkle

// A stable origin preserves WebKit portfolio/layout preferences between launches.
final class Studio: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?
    var log: FileHandle?
    var poll: Timer?
    var attempts = 0
    var checking = false
    var quitting = false
    var recoveryCount = 0
    var updater: SPUStandardUpdaterController?
    var instanceLock: Int32 = -1
    let port = Int(ProcessInfo.processInfo.environment["PROJECT_STUDIO_PORT"] ?? "18765") ?? 18765
    let state = ProcessInfo.processInfo.environment["PROJECT_STUDIO_DATA_DIR"].map { URL(fileURLWithPath: $0) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Project Studio")
    var origin: URL { URL(string: "http://127.0.0.1:\(port)")! }

    func applicationDidFinishLaunching(_ notification: Notification) {
        try? FileManager.default.createDirectory(at: state, withIntermediateDirectories: true)
        instanceLock = Darwin.open(state.appendingPathComponent("desktop.lock").path, O_CREAT | O_RDWR, 0o600)
        if instanceLock < 0 || flock(instanceLock, LOCK_EX | LOCK_NB) != 0 {
            NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "").first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier })?.activate(options: [.activateAllWindows])
            NSApp.terminate(nil); return
        }
        NSApp.setActivationPolicy(.regular)
        updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        let menu = NSMenu()
        let item = NSMenuItem()
        let appMenu = NSMenu(title: "Project Studio")
        appMenu.addItem(withTitle: "About Project Studio", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(withTitle: "Check for Updates…", action: #selector(updates), keyEquivalent: "")
        appMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        appMenu.addItem(withTitle: "Open Application Data", action: #selector(openData), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Project Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        for entry in appMenu.items where entry.action != #selector(NSApplication.terminate(_:)) { entry.target = self }
        item.submenu = appMenu; menu.addItem(item); NSApp.mainMenu = menu
        let configuration = WKWebViewConfiguration()
        configuration.applicationNameForUserAgent = "ProjectStudioNative"
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1160, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Project Studio"; window.contentView = web
        window.minSize = NSSize(width: 760, height: 540); window.isReleasedWhenClosed = false
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        web.loadHTMLString("<body style='background:#0b1925;color:#dce8e8;font:22px -apple-system;padding:64px'><h1>Project Studio</h1><p>Starting your local workspace…</p></body>", baseURL: nil)
        start()
    }
    func start() {
        guard port > 0, let resources = Bundle.main.resourceURL else { fail("Cannot allocate a local service port."); return }
        attempts = 0; checking = false; poll?.invalidate(); try? log?.close()
        do {
            try FileManager.default.createDirectory(at: state, withIntermediateDirectories: true)
            let logURL = state.appendingPathComponent("desktop.log")
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
            log = try FileHandle(forWritingTo: logURL); log?.seekToEndOfFile()
            let process = Process()
            process.executableURL = resources.appendingPathComponent("runtime/studio")
            process.arguments = ["serve", "--port", String(port), "--no-open"]
            process.currentDirectoryURL = state
            var environment = ProcessInfo.processInfo.environment
            environment["PROJECT_STUDIO_PACKAGED"] = "1"
            environment["PROJECT_STUDIO_DATA_DIR"] = state.path
            environment["PROJECT_STUDIO_PORT"] = String(port)
            environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            process.environment = environment; process.standardOutput = log; process.standardError = log
            process.terminationHandler = { [weak self] process in
                DispatchQueue.main.async {
                    guard let self, !self.quitting else { return }
                    self.poll?.invalidate()
                    if self.attempts > 0 && self.recoveryCount < 1 {
                        self.recoveryCount += 1
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.start() }
                    } else { self.fail("The local service stopped or port 18765 is occupied. Close the conflicting service, then use Reload to retry. See desktop.log in Application Data.") }
                }
            }
            try process.run(); server = process
            poll = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.checkReady() }
        } catch { fail("Could not start the bundled service. Open Application Data to inspect desktop.log.") }
    }
    func checkReady() {
        guard !checking else { return }
        attempts += 1
        if attempts > 120 || server?.isRunning != true { poll?.invalidate(); fail("Startup did not complete. Open Application Data to inspect desktop.log."); return }
        checking = true
        var request = URLRequest(url: origin.appendingPathComponent("healthz")); request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self else { return }; self.checking = false
                guard let data, let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any], body["application"] as? String == "project-studio", body["pid"] as? Int32 == self.server?.processIdentifier else { return }
                self.poll?.invalidate(); self.loadStudio()
            }
        }.resume()
    }
    func loadStudio() {
        let file = state.appendingPathComponent("auth/\(port).json")
        guard let data = try? Data(contentsOf: file), let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let token = body["bootstrap"] as? String else { fail("Local session could not be opened."); return }
        var url = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        url.fragment = "studio_bootstrap=" + token
        web.load(URLRequest(url: url.url!))
    }
    func fail(_ message: String) { web.loadHTMLString("<body style='font:18px -apple-system;padding:48px'><h1>Project Studio</h1><p>\(message)</p></body>", baseURL: nil) }
    @objc func reload() { if server?.isRunning == true { loadStudio() } else { recoveryCount = 0; start() } }
    @objc func openData() { NSWorkspace.shared.open(state) }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(nil) }
    @objc func updates() {
        let alert = NSAlert(); alert.messageText = "Check for Project Studio updates?"
        alert.informativeText = "Finish any workspace changes first. Launched tools stay running independently. Installation requires your confirmation."
        alert.addButton(withTitle: "Check for Updates"); alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn { updater?.checkForUpdates(nil) }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { quitting = true; poll?.invalidate(); if server?.isRunning == true { server?.terminate() }; try? log?.close() }
    func local(_ url: URL) -> Bool { url.scheme == "http" && url.host == "127.0.0.1" && url.port == port }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if local(url) || url.scheme == "about" { decisionHandler(.allow) }
        else { if ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { if local(url) { web.load(URLRequest(url:url)) } else if ["http","https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) } }; return nil
    }
}
let application = NSApplication.shared
let delegate = Studio()
application.delegate = delegate
application.run()

from __future__ import annotations

import argparse
import json
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

from install_related_desktop_apps import IconTheme, write_app_icon


def repo_root() -> Path:
    return Path(__file__).resolve().parent


def python_bin() -> Path:
    for candidate in (
        Path("/usr/local/bin/python3"),
        Path("/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"),
        Path("/opt/homebrew/bin/python3"),
        Path("/usr/bin/python3"),
    ):
        if candidate.exists():
            return candidate
    return Path(sys.executable)


def loading_page() -> str:
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Opening Project Studio</title>
  <style>
    :root { color-scheme: dark; font-family: Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif; }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      color: #ecf7ff;
      background:
        radial-gradient(circle at 18% 14%, rgba(62, 182, 244, 0.28), transparent 28rem),
        radial-gradient(circle at 78% 76%, rgba(105, 232, 180, 0.16), transparent 28rem),
        linear-gradient(145deg, #05111c, #0a1a28 55%, #08121b);
    }
    main {
      width: min(640px, calc(100vw - 32px));
      padding: 32px;
      border: 1px solid rgba(158, 214, 237, 0.18);
      border-radius: 28px;
      background: rgba(10, 28, 43, 0.78);
      box-shadow: 0 26px 90px rgba(0, 0, 0, 0.36);
      backdrop-filter: blur(18px);
    }
    .mark {
      width: 76px;
      height: 76px;
      display: grid;
      place-items: center;
      margin-bottom: 20px;
      border-radius: 24px;
      background:
        radial-gradient(circle at 26% 18%, rgba(255,255,255,0.38), transparent 31%),
        radial-gradient(circle at 78% 78%, rgba(116,244,199,0.7), transparent 34%),
        linear-gradient(140deg, #2f8ff0, #101c35);
      box-shadow: 0 18px 44px rgba(47, 143, 240, 0.28);
      font-weight: 900;
      letter-spacing: -0.08em;
    }
    p.eyebrow { margin: 0 0 10px; color: #9ddcf0; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(34px, 6vw, 58px); line-height: 0.96; letter-spacing: -0.06em; }
    p { color: rgba(236, 247, 255, 0.68); line-height: 1.6; }
    .bar { height: 8px; overflow: hidden; margin-top: 24px; border-radius: 999px; background: rgba(255, 255, 255, 0.08); }
    .bar::before {
      content: "";
      display: block;
      width: 42%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #43b8f2, #74f4c7);
      animation: load 1s ease-in-out infinite alternate;
    }
    @keyframes load { from { transform: translateX(-30%); } to { transform: translateX(170%); } }
    #status { margin-top: 18px; color: #c6f4ff; font-weight: 800; }
  </style>
</head>
<body>
  <main>
    <div class="mark">PS</div>
    <p class="eyebrow">Local development</p>
    <h1>Opening Project Studio</h1>
    <p>The dockable project launcher is starting from the live local project folder. This page will redirect automatically when the local server is ready.</p>
    <div class="bar" aria-hidden="true"></div>
    <div id="status">Checking local launcher...</div>
  </main>
  <script>
    const target = "http://127.0.0.1:8765/";
    const statusEl = document.getElementById("status");
    let checks = 0;
    async function check() {
      checks += 1;
      statusEl.textContent = `Waiting for launcher (${checks})...`;
      try {
        await fetch(target, { mode: "no-cors", cache: "no-store" });
        window.location.replace(target);
      } catch (error) {
        setTimeout(check, checks < 35 ? 120 : checks < 80 ? 350 : 1200);
      }
    }
    check();
  </script>
</body>
</html>
"""


def swift_string(value: str | Path) -> str:
    return json.dumps(str(value))


def native_launcher_source(root: Path, python: Path, launcher: Path) -> str:
    state_dir = root / "outputs" / "launcher-ui"
    log_file = state_dir / "server.log"
    pid_file = state_dir / "server.pid"
    url_file = state_dir / "server.url"
    path_value = (
        "/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:"
        "/Library/Frameworks/Python.framework/Versions/3.13/bin:"
        "/Library/Frameworks/Python.framework/Versions/3.11/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    )
    return f"""
import Cocoa
import Darwin
import Foundation
import WebKit

private let repoRoot = {swift_string(root)}
private let pythonBin = {swift_string(python)}
private let launcherScript = {swift_string(launcher)}
private let stateDir = {swift_string(state_dir)}
private let logFile = {swift_string(log_file)}
private let pidFile = {swift_string(pid_file)}
private let urlFile = {swift_string(url_file)}
private let pathValue = {swift_string(path_value)}
private let launcherURL = URL(string: "http://127.0.0.1:8765/")!
private let healthURL = URL(string: "http://127.0.0.1:8765/healthz")!

final class LauncherAppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {{
    private var window: NSWindow?
    private var webView: WKWebView?
    private var pollTimer: Timer?
    private var serverProcess: Process?
    private var serverLogHandle: FileHandle?

    func applicationDidFinishLaunching(_ notification: Notification) {{
        NSApp.setActivationPolicy(.regular)
        installMainMenu()
        showWindow()
        if isServerReady(timeout: 0.35) {{
            loadLauncher()
        }} else {{
            loadLoadingPage()
            startServer()
            startPollingForServer()
        }}
        presentMainWindow()
    }}

    private func installMainMenu() {{
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu(title: "Project Studio")
        appMenu.addItem(NSMenuItem(title: "Quit Project Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        let reloadItem = NSMenuItem(title: "Reload Project Studio", action: #selector(reloadProjectStudio(_:)), keyEquivalent: "r")
        reloadItem.keyEquivalentModifierMask = [.command]
        reloadItem.target = self
        viewMenu.addItem(reloadItem)
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        NSApp.mainMenu = mainMenu
    }}

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {{
        showWindow()
        if isServerReady(timeout: 0.20) {{
            loadLauncher()
        }} else {{
            loadLoadingPage()
            startServer()
            startPollingForServer()
        }}
        presentMainWindow()
        return true
    }}

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {{
        return false
    }}

    private func showWindow() {{
        if window == nil || webView == nil {{
            let configuration = WKWebViewConfiguration()
            configuration.applicationNameForUserAgent = "ProjectStudioNative"
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
            let view = WKWebView(frame: .zero, configuration: configuration)
            if #available(macOS 12.0, *) {{
                view.underPageBackgroundColor = NSColor(red: 7/255, green: 17/255, blue: 28/255, alpha: 1)
            }}
            view.navigationDelegate = self
            view.uiDelegate = self
            view.allowsBackForwardNavigationGestures = true

            let newWindow = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 980, height: 720),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            newWindow.backgroundColor = NSColor(red: 7/255, green: 17/255, blue: 28/255, alpha: 1)
            newWindow.title = "Project Studio"
            newWindow.minSize = NSSize(width: 760, height: 540)
            newWindow.contentView = view
            newWindow.isReleasedWhenClosed = false
            newWindow.center()

            webView = view
            window = newWindow
        }}
        window?.makeKeyAndOrderFront(nil)
    }}

    private func presentMainWindow() {{
        NSApp.unhide(nil)
        window?.makeKeyAndOrderFront(nil)
        window?.orderFrontRegardless()
        NSRunningApplication.current.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
        NSApp.activate(ignoringOtherApps: true)
    }}

    private func ownerURL(_ url: URL) -> URL {{
        guard isLauncherURL(url) else {{ return url }}
        let path = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/state/project-studio/auth/8765.json")
        guard let data = try? Data(contentsOf: path),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let bootstrap = object["bootstrap"] as? String,
              var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {{ return url }}
        parts.fragment = "studio_bootstrap=" + bootstrap
        return parts.url ?? url
    }}

    private func loadLauncher() {{
        webView?.load(URLRequest(url: ownerURL(launcherURL), cachePolicy: .useProtocolCachePolicy, timeoutInterval: 10))
    }}

    private func loadLoadingPage() {{
        if let loadingURL = Bundle.main.resourceURL?.appendingPathComponent("loading.html") {{
            webView?.loadFileURL(loadingURL, allowingReadAccessTo: loadingURL.deletingLastPathComponent())
        }}
    }}

    @objc private func reloadProjectStudio(_ sender: Any?) {{
        restartServerAndReload()
    }}

    private func restartServerAndReload() {{
        pollTimer?.invalidate()
        pollTimer = nil
        loadLoadingPage()
        stopKnownServerProcess()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {{ [weak self] in
            guard let self else {{
                return
            }}
            self.startServer()
            self.startPollingForServer()
        }}
    }}

    private func stopKnownServerProcess() {{
        if let process = serverProcess, process.isRunning {{
            process.terminate()
        }}
        serverProcess = nil
        serverLogHandle = nil

        guard let text = try? String(contentsOfFile: pidFile, encoding: .utf8),
              let pidValue = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)),
              pidValue > 0 else {{
            return
        }}
        Darwin.kill(pidValue, SIGTERM)
    }}

    private func startServer() {{
        if isServerReady(timeout: 0.15) {{
            return
        }}
        let fileManager = FileManager.default
        try? fileManager.createDirectory(atPath: stateDir, withIntermediateDirectories: true)
        try? fileManager.removeItem(atPath: pidFile)
        try? fileManager.removeItem(atPath: urlFile)
        if !fileManager.fileExists(atPath: logFile) {{
            fileManager.createFile(atPath: logFile, contents: nil)
        }}

        let process = Process()
        process.executableURL = URL(fileURLWithPath: pythonBin)
        process.arguments = [launcherScript, "--port", "8765", "--no-open"]
        process.currentDirectoryURL = URL(fileURLWithPath: repoRoot)
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = pathValue + ":" + (environment["PATH"] ?? "")
        process.environment = environment

        do {{
            let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: logFile))
            handle.seekToEndOfFile()
            process.standardOutput = handle
            process.standardError = handle
            try process.run()
            serverProcess = process
            serverLogHandle = handle
        }} catch {{
            appendLauncherLog("Failed to launch Project Studio server: \\(error)")
        }}
    }}

    private func startPollingForServer() {{
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) {{ [weak self] timer in
            guard let self else {{
                timer.invalidate()
                return
            }}
            if self.isServerReady(timeout: 0.12) {{
                timer.invalidate()
                self.pollTimer = nil
                self.loadLauncher()
            }}
        }}
    }}

    private func isServerReady(timeout: TimeInterval) -> Bool {{
        var request = URLRequest(url: healthURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = timeout
        let semaphore = DispatchSemaphore(value: 0)
        var ready = false
        let task = URLSession.shared.dataTask(with: request) {{ _, response, error in
            if error == nil, response != nil {{
                ready = true
            }}
            semaphore.signal()
        }}
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout + 0.15)
        task.cancel()
        return ready
    }}

    private func isLauncherURL(_ url: URL) -> Bool {{
        guard let host = url.host else {{
            return false
        }}
        let normalizedHost = host.lowercased()
        return (normalizedHost == "127.0.0.1" || normalizedHost == "localhost") && (url.port ?? 80) == 8765
    }}

    private func isCaptureLaunchURL(_ url: URL) -> Bool {{
        guard isLauncherURL(url),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else {{
            return false
        }}
        let path = url.path
        let captureEnabled = queryItems.contains {{ item in
            item.name == "capture" && ["1", "true", "yes", "on"].contains((item.value ?? "").lowercased())
        }}
        return captureEnabled && (
            (path.hasPrefix("/apps/") && path.hasSuffix("/open")) ||
            (path.hasPrefix("/links/") && path.hasSuffix("/open"))
        )
    }}

    private func selectLatestChromeTab() {{
        let script = "tell application \\\"Google Chrome\\\"\\nif (count windows) > 0 then\\nactivate\\nset active tab index of front window to (count tabs of front window)\\nend if\\nend tell"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        try? process.run()
    }}

    private func handleExternalURL(_ url: URL) {{
        NSWorkspace.shared.open(ownerURL(url))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {{ [weak self] in
            self?.loadLauncher()
            self?.selectLatestChromeTab()
        }}
    }}

    private func appendLauncherLog(_ message: String) {{
        try? FileManager.default.createDirectory(atPath: stateDir, withIntermediateDirectories: true)
        let line = "[Native wrapper] \\(message)\\n"
        if let data = line.data(using: .utf8) {{
            if !FileManager.default.fileExists(atPath: logFile) {{
                FileManager.default.createFile(atPath: logFile, contents: nil)
            }}
            if let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: logFile)) {{
                handle.seekToEndOfFile()
                handle.write(data)
                try? handle.close()
            }}
        }}
    }}

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {{
        guard let url = navigationAction.request.url else {{
            decisionHandler(.allow)
            return
        }}
        if url.isFileURL || url.scheme == "about" {{
            decisionHandler(.allow)
            return
        }}
        if isCaptureLaunchURL(url) {{
            handleExternalURL(url)
            decisionHandler(.cancel)
            return
        }}
        if isLauncherURL(url) {{
            decisionHandler(.allow)
            return
        }}
        handleExternalURL(url)
        decisionHandler(.cancel)
    }}

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {{
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url else {{
            return nil
        }}
        if isCaptureLaunchURL(url) {{
            handleExternalURL(url)
        }} else if isLauncherURL(url) {{
            webView.load(URLRequest(url: url))
        }} else {{
            handleExternalURL(url)
        }}
        return nil
    }}
}}

let app = NSApplication.shared
let delegate = LauncherAppDelegate()
app.delegate = delegate
app.run()
"""


def write_native_launcher(executable: Path, resources_dir: Path, root: Path, python: Path, launcher: Path) -> bool:
    swiftc = shutil.which("swiftc") or "/usr/bin/swiftc"
    if not Path(swiftc).exists():
        print("swiftc was not found. Install Xcode Command Line Tools to build the native launcher app.", file=sys.stderr)
        return False
    if not Path("/System/Library/Frameworks/WebKit.framework").exists():
        print("WebKit.framework was not found. The native launcher app requires macOS WebKit.", file=sys.stderr)
        return False
    source = resources_dir / "launcher.swift"
    module_cache = resources_dir / ".swift-module-cache"
    module_cache.mkdir(parents=True, exist_ok=True)
    source.write_text(native_launcher_source(root, python, launcher), encoding="utf-8")
    env = os.environ.copy()
    env["CLANG_MODULE_CACHE_PATH"] = str(module_cache)
    result = subprocess.run(
        [
            swiftc,
            str(source),
            "-o",
            str(executable),
            "-framework",
            "Cocoa",
            "-framework",
            "WebKit",
            "-module-cache-path",
            str(module_cache),
        ],
        capture_output=True,
        env=env,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        return False
    executable.chmod(0o755)
    return True


def finalize_app_bundle(app: Path) -> None:
    def run_quietly(args: list[str]) -> None:
        subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)

    run_quietly(["/usr/bin/xattr", "-dr", "com.apple.quarantine", str(app)])
    run_quietly(["/usr/bin/xattr", "-dr", "com.apple.provenance", str(app)])
    run_quietly(["/usr/bin/codesign", "--force", "--deep", "--sign", "-", str(app)])
    lsregister = Path("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
    if lsregister.exists():
        run_quietly([str(lsregister), "-f", str(app)])


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the native macOS Project Studio wrapper app.")
    parser.add_argument("--desktop", type=Path, default=Path.home() / "Desktop", help="Folder where Project Studio.app should be written.")
    parser.add_argument("--check", action="store_true", help="Validate prerequisites without writing the app bundle.")
    args = parser.parse_args()

    root = repo_root()
    launcher = root / "local_tools_launcher.py"
    python = python_bin()
    swiftc = shutil.which("swiftc") or "/usr/bin/swiftc"
    webkit = Path("/System/Library/Frameworks/WebKit.framework")

    if args.check:
        checks = {
            "repo_root": root.exists(),
            "launcher_script": launcher.exists(),
            "python": python.exists(),
            "swiftc": Path(swiftc).exists(),
            "webkit": webkit.exists(),
        }
        for name, ok in checks.items():
            print(f"{'OK' if ok else 'MISSING'} {name}")
        return 0 if all(checks.values()) else 1

    if not launcher.exists():
        print(f"Launcher server not found: {launcher}", file=sys.stderr)
        return 1
    desktop = args.desktop.expanduser()
    if not desktop.exists():
        print(f"Desktop folder not found: {desktop}", file=sys.stderr)
        return 1

    legacy_app = desktop / "Local Tools Launcher.app"
    if legacy_app.exists():
        shutil.rmtree(legacy_app)

    app = desktop / "Project Studio.app"
    if app.exists():
        shutil.rmtree(app)

    macos_dir = app / "Contents" / "MacOS"
    resources_dir = app / "Contents" / "Resources"
    macos_dir.mkdir(parents=True)
    resources_dir.mkdir(parents=True)

    executable_name = "launcher"
    executable = macos_dir / executable_name
    loading = resources_dir / "loading.html"
    loading.write_text(loading_page(), encoding="utf-8")
    if not write_native_launcher(executable, resources_dir, root, python, launcher):
        return 1
    write_app_icon(resources_dir, IconTheme("PS", "#2f8ff0", "#101c35", "#74f4c7", "network"))

    plist = {
        "CFBundleDisplayName": "Project Studio",
        "CFBundleExecutable": executable_name,
        "CFBundleIconFile": "AppIcon",
        "CFBundleIdentifier": "org.undp.project-studio",
        "CFBundleName": "Project Studio",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.0",
        "CFBundleVersion": "1",
        "LSMinimumSystemVersion": "10.15",
        "NSDesktopFolderUsageDescription": "Project Studio opens local development tools from your project folders.",
        "NSDocumentsFolderUsageDescription": "Project Studio starts local development tools stored in your Documents folder.",
        "NSDownloadsFolderUsageDescription": "Project Studio may open downloaded local project assets when launching tools.",
    }
    with (app / "Contents" / "Info.plist").open("wb") as fh:
        plistlib.dump(plist, fh)
    finalize_app_bundle(app)

    print(f"Created wrapper launcher app: {app}")
    print("Double-click Project Studio, then drag it to the Dock if you want it pinned.")
    print(f"Server logs: {root / 'outputs' / 'launcher-ui' / 'server.log'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

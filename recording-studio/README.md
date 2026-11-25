# Recording Studio: Developer Guide

For intended behavior, read [PRODUCT_SPEC.md](PRODUCT_SPEC.md). For user steps, see
the [quick start](../assets/docs/recording-studio.md). This README owns setup,
implementation references and maintenance procedures, not a second product spec.

## Setup

Requires Node 22, installed Google Chrome, and FFmpeg on PATH. From this package:

```sh
npm ci
npm run build
npm start
```

Project Studio normally starts the service automatically. Its default address is
`http://127.0.0.1:3015`; the shell runs at `http://127.0.0.1:8765`.
Rebuild and reload recording windows after runtime changes. Restart the service
after service changes. Neither step requires rebuilding the host app. Do not restart
the shared service while another app is recording or exporting.

## Implementation Map

| Area | Entry points |
| --- | --- |
| Launcher, profiles and resolved app URL | `../local_tools_launcher.py`, `../install_related_desktop_apps.py` |
| Runtime mount and service transport | `src/entry.tsx`, `src/runtime.ts`, `src/ViewportOverlay.tsx` |
| Panel, library and timeline UI | `src/WalkthroughRecorder.tsx`, `src/WalkthroughMount.tsx`, `src/styles.tsx` |
| Playback, state and targeting | `src/WalkthroughPlayer.tsx`, `src/playbackClock.ts`, `src/stateSnapshot.ts`, `src/actionEffects.ts`, `src/targeting.ts` |
| Pointer rendering | `src/CursorGraphic.tsx`, `src/cursorGeometry.ts`, `src/cursorSettings.ts`, `src/motion.ts` |
| Browser and file persistence | `src/storage.ts`, `scripts/recording-library.mjs` |
| Sessions, access checks and injection | `scripts/recording-sessions.mjs` |
| Export jobs and runner | `scripts/walkthrough-export-service.mjs`, `scripts/run-walkthrough-playwright.mjs`, `scripts/frameTimeline.mjs` |
| Shared export defaults | `shared/exportSettings.mjs` |
| Saved plan types and generic defaults | `src/types.ts`, `src/walkthroughPlan.json` |
| Historical tracker script example | `examples/energy-tracker-script.json` |

The package bundles its own React and styling dependencies into `dist/recorder.js`.
The launcher shell remains Python and vanilla JavaScript. Browser styles are isolated
through a Shadow DOM mount, except intentional playback-time page effects.

## Files and Backups

Paths below are relative to this package unless configured otherwise.

| Content | Default path |
| --- | --- |
| Central recordings | `outputs/recordings/<app-id>/<recording-id>.json` |
| Managed Chrome profiles | `outputs/profiles/<app-id>` |
| Service videos, plans, job status and logs | `outputs/exports/<job-id>` |
| Direct CLI exports | `outputs/playwright` |

`RECORDING_STUDIO_DATA_DIR` relocates recordings and profiles;
`WALKTHROUGH_EXPORT_OUTPUT_DIR` relocates service exports. Back up these locations
with the service stopped. Profiles may contain credentials; restrict access and do
not commit them. Never expose the service port publicly.

The persisted recording envelope currently uses `schemaVersion: 1`, app/recording
IDs, URL, name, dates, revision, action count and a typed plan. Request validation and
revision handling live in `recording-library.mjs`; plan types live in `src/types.ts`.
Consult [DATA-01 through DATA-05](PRODUCT_SPEC.md#saving-and-compatibility) before
changing serialization or import behavior. Do not hand-edit a live recording file
while the editor is open.

## Integrating an App

Register the app through Project Studio's existing registry. Configure its supported
languages/export availability in the recording profile. The launcher passes the app
ID, resolved URL and readiness selector into the recording session; update the
session payload where a custom readiness selector is needed.

Prefer `data-walkthrough-target` markers or stable IDs on interactive controls.
Expose an optional state adapter when DOM snapshots alone are insufficient:

```js
window.__projectStudioAdapter = {
  getState: () => ({ filters: readCurrentFilters() }),
  applyState: async (state) => {
    await applySupportedState(state); // Include state.language if supported.
    await waitForAppToSettle();
  },
};
window.dispatchEvent(new CustomEvent('moonshot-walkthrough-app-state-change'));
```

The function names in this example are app-provided, not recorder APIs. State must
be JSON-serializable. Define partial-state handling deliberately and dispatch the
state-change event when the app's relevant selections change.

`__moonshotWalkthroughState` and the historical event/storage names remain compatibility
aliases. The tracker's development-only shortcut loader lives in its own app and
loads `/runtime.js`; it does not own the recorder implementation. See
[integration requirements](PRODUCT_SPEC.md#ownership-and-launch) and
[supported boundaries](PRODUCT_SPEC.md#supported-boundaries-and-known-gaps).

## Service Reference

Session creation is a local launcher operation. Library/export requests use the
origin-checked managed-browser binding or an attached local session's bearer token.

| Endpoint | Purpose / payload |
| --- | --- |
| `GET /api/recording-studio/health` | Service version and library location |
| `GET /runtime.js` | Built runtime |
| `POST /api/recording-studio/sessions` | `appId`, `url`, optional `language`, `languages`, `readySelector`, `videoExportEnabled`, `recordingId`; local `attach` mode returns session configuration |
| `GET /api/recording-studio/library` | Session app's recordings |
| `POST /api/recording-studio/library` | Recording envelope and expected `revision` (zero for a new record) |
| `DELETE /api/recording-studio/library/:id` | Remove a recording |
| `POST /api/recording-studio/library/import` | `{ recordings }` legacy import |
| `GET /api/walkthrough-export/health` | Export service availability |
| `GET /api/walkthrough-export/jobs` | Session app's export jobs |
| `POST /api/walkthrough-export/jobs` | `plan`, `name`, `languages`, `settings` |
| `GET /api/walkthrough-export/jobs/:id` | Progress/status/output location |
| `POST /api/walkthrough-export/jobs/:id/cancel` | Cancel a job |

Exact request checks remain in the corresponding service files. Change the client
and server together when evolving this interface. Access and lifecycle requirements
are in [the spec](PRODUCT_SPEC.md#video-export), not inferred from this endpoint list.

## Validation

From the recording package:

```sh
npm run typecheck
npm test
node tests/shared-runtime.mjs --export
```

The browser test starts its own fixture/service (port 3017), opens headless Chrome
and writes test artifacts. Ensure that port and adequate disk space are available.
It covers plain-HTML integration and a real export; Vitest and Node tests cover
targeting, cursor/timing, storage/revisions and encoded frame counts.

With Project Studio, the shared service and the tracker already running locally:

```sh
node tests/tracker-integration.mjs
node tests/export-api-smoke.mjs
```

These integration tests use the configured local ports and create test sessions or
export artifacts. The tracker test disables AI calls in its test page. Use them only
when it is safe to exercise the local services, not during another active export.

After launcher changes, run Project Studio's checks from its root:

```sh
python3 -m py_compile local_tools_launcher.py install_related_desktop_apps.py install_tools_launcher_app.py spa_static_server.py capture_portfolio.py extract_video_screenshots.py
node --check assets/studio.js
node --check assets/portfolio.js
python3 local_tools_launcher.py --check
```

Review actual video frames when changing cursor, zoom, timing or export code. Use
the [acceptance matrix](PRODUCT_SPEC.md#acceptance-and-verification) to select other
regressions; a successful compile does not establish product fidelity.

## Troubleshooting

| Symptom | First checks |
| --- | --- |
| Recorder does not open | Recording-service launch log, `/api/recording-studio/health`, Chrome installation, bundle presence, readiness selector |
| Changes are not visible | Rebuild this package, reload the recording window; restart only if service code changed |
| Old recording missing | Correct app ID; for browser-only recordings follow the quick-start import steps in the original profile/origin |
| Save conflict or recovered draft | Reopen the central record and compare the recovered copy; do not force-overwrite the other revision |
| Export fails | Job error and `export.log`, free disk, FFmpeg/Chrome availability, app readiness and authentication |
| Playback selects the wrong thing | Stable targets, app state adapter, saved framing and changes to the app layout/data |

For product changes, update the spec first or in the same change. For internal
refactors, keep the spec stable and change this guide only if developer procedures
or implementation references change. Historical verification belongs in the
[migration archive](../docs/archive/recording-studio-migration-2026-09-08.md).

## Export performance

The editor defaults to **1080p, 30 FPS, Standard**. Select 1080p, 1440p,
or 4K independently of quality. The recorded viewport and layout stay unchanged;
the export fits inside that resolution while preserving aspect ratio (including portrait).
CLI: `--resolution 1080p --fps 30 --quality standard`. API settings include
`resolution`, `fps`, and `quality`; the shared defaults live in `shared/exportSettings.mjs`.

Standard uses JPEG capture and Apple's `h264_videotoolbox` hardware encoder on
macOS after a real availability probe. If unavailable, it uses fast software H.264.
High uses PNG capture with fast software encoding and full chroma detail. Maximum
retains PNG, higher fidelity compression, and conservative capture timing. The
hardware option trades some compression efficiency/chroma detail for speed.

Standard/High use 2x, 3x, and 5x capture timing at 30/60/120 FPS respectively.
Maximum keeps 4x/6x/8x. Output duration is preserved by timestamp resampling;
slow apps can still produce repeated frames. Chrome capture remains sRGB with
explicit color conversion and matching video metadata.

Progress identifies browser preparation, capture, encoding, and finalization.
Encoding shows FFmpeg's actual completed/total frames and encoder. Other stages
remain estimates; 100% is only reported after successful process completion.
Disk estimates use the chosen resolution, capture format, and timing multiplier.

Run `node tests/export-performance.mjs` for isolated real exports across resolutions
and hardware/software paths. It uses temporary data and does not restart the live service.

Playback uses a fixed arrow over clickable elements, avoiding shape/hotspot switches
and per-frame DOM hit tests. The former default 58px arrow is normalized to 24px
(including saved plans). Explicit other sizes and non-arrow cursor shapes remain
customizable. Large circle actions use fewer default revolutions at the same duration
for smoother motion; explicitly saved loop counts still take precedence.

## Reliability and Performance Review (October 2026)

The runtime stays split into the injected editor/player, the central recording
library, and the export service/worker. A new framework or host-app integration is
not required for these improvements:

- Library refreshes, saves, approvals and deletes are serialized in the client.
  Slow reads cannot replace newer save responses. Server revision checks still
  reject conflicting edits from another window.
- Each recovered browser draft receives a fresh recording ID. Importing a later
  recovery cannot accidentally reuse an older recovery and discard its contents.
- Corrupt recording files are retained, with the offending filename reported.
  The library deliberately fails visibly rather than silently hiding recordings.
- Export admission covers asynchronous preflight as well as execution. A canceled
  worker continues occupying the slot until its process closes. Cancellation during
  preparation prevents the worker from being spawned.
- The service retains only 200 recent log lines per live job in memory; complete
  logs remain on disk. Status/health polling does not overlap slow requests.
- Compositor frame acknowledgments apply backpressure when disk writes fall behind.
  This bounds capture pressure rather than silently dropping frames in JavaScript.
  Slow storage can still reduce capture cadence; this is not a guarantee of a fixed
  source frame rate.
- Local service HTTP requests time out after 30 seconds. A timed-out mutation may
  have completed on the server: refresh the library before retrying a save.

Verification uses `npm test`, `npm run typecheck`, `npm run build`,
`node tests/shared-runtime.mjs`, and `node tests/export-performance.mjs`.
Browser integration tests use temporary storage and ephemeral ports, not the user's
recordings or the normal live service. The export test verifies resolutions, color
metadata, actual encoded frame counts and rejection of concurrent exports.

Remaining limits: replay quality depends on stable selectors and host-app state;
fixture tests do not certify every host app. High-resolution/maximum-quality
exports remain CPU/GPU and disk intensive. End-to-end long-recording profiling is
needed before claiming a throughput improvement. No existing recordings or exports
are rewritten by this refactor.

## Pointer Motion

Playback and video exports share the same deterministic motion helpers in
`src/motion.ts`. Short moves are straight; longer moves use restrained curves and
arc-length sampling with a quick departure and a longer final approach. Default
travel times scale with distance, while explicit movement durations are preserved.
Circles default to one closed loop with a tangent-aligned entrance and smooth stop;
explicit loop counts and durations remain supported. Default circle timing grows
with path length instead of making large circles excessively fast.

Clicks borrow a short settling interval from their existing pause budget and no
longer shrink the cursor. Hover pauses are stationary and honor explicit dwell
settings. Scrolling keeps the cursor in viewport position rather than hiding it.
Typing uses repeatable per-character delays, with longer punctuation pauses;
those delays sum to the configured typing duration. Zero-length pauses remain zero.
No random per-frame jitter or interactive-target overshoot is introduced.

There is currently no drag action in the recording schema. These changes do not
claim to add drag recording/replay or wheel-step scrolling. Existing saved plans
are unchanged, but default motion pacing will differ when replayed with this build.
Close managed recording windows and launch again to load a rebuilt runtime;
refreshing a managed window alone can reuse its previously injected bundle.

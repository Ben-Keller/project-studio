# Recording Studio Product Specification

Status: current product baseline. Last reviewed: 2026-09-08.
Owner: Project Studio. Applies to the shared Recording Studio feature across apps.

## Authority and Maintenance

This is the source of truth for intended product behavior and acceptance criteria.
It is not a claim that every edge case has automated test coverage. Known limitations
and future ideas are explicitly separated below; undocumented behavior is not a new
requirement merely because the current code happens to implement it.

| Document | Responsibility |
| --- | --- |
| This specification | What the product must do and its supported boundaries |
| [Developer README](README.md) | How to install, integrate, develop, test and troubleshoot it |
| [Quick start](../assets/docs/recording-studio.md) | Short instructions for recording and export |
| [Archived migration workplan](../docs/archive/recording-studio-migration-2026-09-08.md) | Historical decisions and verification at migration time, not current guidance |

For a behavior change, update the relevant requirement here and its tests in the same
change. Update the quick start only if the user steps change. For a refactor that
preserves behavior, update technical documentation only where necessary. Changes to
saved formats must explain compatibility and recovery for existing recordings.
Do not maintain parallel product rules in workplans, app card docs or conversation
summaries. Link to the appropriate requirement instead. Resolve contradictions
explicitly rather than silently changing this specification to match a regression.

## Purpose and Scope

Enable a local app creator to record demonstration actions once, refine the sequence,
preview it with a polished pointer, and export repeatable videos. The same feature
must serve the energy tracker and other registered apps without copying its UI or
playback logic into each app.

The primary journey is: open an app with recording tools, open or create a recording,
capture and refine actions in one editor, preview, then export selected languages.
The recording is the durable document; a browser session and an export job are
temporary activities associated with it.

Out of scope: cloud/team collaboration, arbitrary desktop recording, universal
reconstruction of server state, automatic translation of apps, video/audio editing,
and a separate screen-sharing recorder that duplicates the walkthrough implementation.

## Core Requirements

### Ownership and Launch

- **INT-01 Single implementation.** Project Studio owns one recorder/editor/player
  implementation. Attached local tabs, managed sessions and export use its shared
  runtime, not app-specific copies. App production bundles must not acquire the
  recorder UI or its dependencies through this integration.
- **INT-02 Opt-in launch.** Enabling recording tools and launching a registered app
  opens the app at its resolved runtime URL in managed Chrome with the recorder.
  Ordinary app launch remains unchanged. Startup failure must be visible and offer
  a retry or a useful next step, not an indefinite blank panel.
- **INT-03 Small adapters.** Ordinary DOM apps do not need to install the recorder's
  framework. App-specific integration is limited to readiness, stable targets,
  state restoration and language switching where those capabilities are needed.
- **INT-04 Session boundaries.** Managed Chrome uses a separate app profile. Only
  one managed recording window per app is supported at a time. Stopping one app
  must not stop the shared service or another app's export. Stopping the shared
  service explicitly may end its recording sessions and running jobs.

### Library and Editor

- **UX-01 One workspace.** The app's recording library and editor belong to one
  recorder panel. Creating or opening a recording shows the editor instead of the
  library. The back icon returns to the library without a separate confirmation
  step once saving succeeds. Export belongs inside the open recording, not as a
  competing editor or preview interface.
- **UX-02 Minimal library.** Show recording names, dates and action counts, with
  open/edit, delete and record-new actions. Avoid a separate selected-recording
  state when no recording is open. Deleting a saved recording is explicit and
  currently requires confirmation; this differs from returning to the library.
- **UX-03 Compact controls.** The panel is movable. Use concise icon controls with
  accessible names/tooltips; cursor and export settings can expand on demand.
  Panel interaction must not become a recorded page action.
- **UX-04 Action timeline.** Show the starting state and an ordered action log with
  the current action indicated. Users can select a state, delete actions and record
  additional actions from the selected position. Playback is controlled by one
  play/pause control. Selection is by action/state, not by encoded video frame.

### Recording and Pointer Behavior

- **REC-01 Capture actual interactions.** While recording, capture supported page
  clicks, typing and scrolling. Do not manufacture duplicate clicks or type actions
  from the recorder UI, playback, or unrelated programmatic updates. Password-input
  values are excluded; this is not a general-purpose sensitive-data redactor.
- **REC-02 Location tools.** Hover and circle tools placed from the panel use drag
  and drop onto the page. Clicking a tool alone must not record the panel's position
  as its destination. Indicate the pending target and whether the drop is valid.
- **REC-03 Non-location tools.** A scroll marker captures the current page position.
  Hover-effects toggling records a global playback state, not a point under the
  pointer. Provide feedback when a command is recorded.
- **REC-04 Pointer presentation.** Travel uses smooth curved motion with easing,
  rather than abrupt jumps or uniformly linear movement. Circle highlights use
  irregular oval motion and configurable size. The cursor shape stays fixed during
  a circle; crossing hoverable elements must not change it. Clicks have a visible
  pulse, and the pointer proceeds from its last position without a reset jump.
- **REC-05 Saved appearance.** Cursor appearance, action timing and export framing
  are part of the recording, not unsaved browser-only preferences. Preview and export
  use the same cursor geometry and hotspot rules. Settings include shape, size,
  colors, opacity, outline and shadow.

### State Restoration and Playback

- **PLAY-01 Checkpoints.** Record the starting state and per-action snapshots of
  supported app/UI state, scroll position and hover-effect state. Starting review at
  a selected action restores the required context, rather than assuming the app
  already has the same filters or selection.
- **PLAY-02 Real effects.** Playback must activate the intended supported controls,
  not merely draw a click over them. Prefer stable element targets and relative
  positions within them; raw coordinates are less portable across changed layouts.
- **PLAY-03 Interruptibility.** Pausing or stopping must cancel pending motion and
  delayed action effects so a click cannot fire afterward. Resume uses the selected
  or paused action boundary. Exact video-frame stepping is not part of this baseline.
- **PLAY-04 Isolation.** Recorder styling must not restyle the host app, and host
  styling must not distort recorder controls or pointer graphics. Playback-specific
  hover suppression and scrolling adjustments must be scoped to the activity and
  cleaned up when it ends.

### Saving and Compatibility

- **DATA-01 Durable, app-scoped library.** Save recordings centrally by stable app
  and recording IDs, including name, dates, revision and the complete plan. Reopening
  a session must not require recreating saved recordings. Runtime URL/port changes
  must not create a new library for the same registered app.
- **DATA-02 Automatic saving.** Changes save automatically without Save, Complete
  or Download JSON as required workflow steps. Returning to the library waits for
  saving; failure keeps the editor available and reports that changes are not saved.
  A save still in flight must not overwrite newer edits in the editor.
- **DATA-03 Conflict and recovery.** Writes replace complete documents atomically;
  stale revisions are rejected rather than silently overwriting another edit.
  Preserve the last submitted draft for best-effort recovery when browser storage
  is available. Recovery is not a guarantee of every keystroke surviving hard closure.
- **DATA-04 Existing recordings.** Support importing the earlier browser-stored
  tracker recordings without deleting their originals. Repeating a successful import
  must not duplicate records or replace newer central edits. A separate managed
  profile cannot discover another browser profile's storage without the user opening
  the recorder in that original browser/origin.
- **DATA-05 Compatibility.** Preserve supported legacy plan/event/state-adapter
  contracts unless an explicit migration is provided. Old migration documents are
  historical evidence, not an alternative live implementation contract.

### Video Export

- **EXP-01 Same playback.** Export the open recording through the shared player and
  cursor renderer. Honor saved framing and supported language/state adapters. A
  successful MP4 encode alone is not sufficient evidence of visual fidelity.
- **EXP-02 In-editor controls.** Allow language, resolution, and quality/frame-rate selection in
  the editor, show progress and useful failure information, support cancellation,
  and identify the output location on completion. Respect app profiles that disable
  video export. Export must not require a separate command-line workflow.
- **EXP-03 Bounded jobs.** The local service supports one active export at a time.
  Additional requests are rejected clearly, not silently launched in parallel.
  Check disk capacity before starting; failed or interrupted jobs must not be shown
  as complete. Job status survives service restart, with interrupted work identified.
- **EXP-04 App-supported languages.** Offer configured languages only. The app is
  responsible for changing its own language; the recorder does not generate
  translations. Selecting a language must not be represented as proof the app
  implements that language correctly.
- **EXP-05 Private sessions.** Managed-session exports may inherit that app profile's
  cookies/local storage through temporary private state. Attached ordinary tabs
  cannot transfer HTTP-only cookies. Keep recording data and authentication material
  local; remove temporary export state after completion or cleanup on restart.

### Local Safety

- **SAFE-01 Local developer tool.** Keep the service loopback-only and validate its
  browser/session access. Managed-page calls are restricted to recording operations
  for the session origin. Export targets come from the active session, not arbitrary
  URLs supplied by the editor. This is not a multi-user authorization service.
- **SAFE-02 User data.** Saved app state, typed text, profiles and videos may contain
  private data. Do not imply automatic anonymization. Recording/preview may activate
  real app behavior, so demonstrations should avoid destructive or irreversible actions.

## Acceptance and Verification

Use the [README validation instructions](README.md#validation) for commands and test
locations. Acceptance is based on observed behavior, not test counts or a past build.

| Scenario | Requirements | Acceptance evidence |
| --- | --- | --- |
| Launch plain HTML and tracker through shared tools | INT-01 to INT-03, PLAY-04 | Both use one runtime; host CSS does not break the panel; normal launch still works |
| Record, reopen and edit a demonstration | UX-01 to UX-04, REC-01, DATA-01/02 | One action per click, no panel/type noise, saved plan opens from the library |
| Drag hover/circle tools and change pointer appearance | REC-02 to REC-05 | Correct drop target, no panel click capture, fixed circle cursor and saved appearance |
| Start from a selected state, then pause a pending click | PLAY-01 to PLAY-03 | Supported selections/scroll restored; no delayed click fires after pause |
| Fail a save or submit a stale revision | DATA-02/03 | Clear error, editor retained, original data not overwritten; recoverable draft retained where storage permits |
| Import legacy recordings twice | DATA-04/05 | No duplicates, no loss of browser originals or newer central edits |
| Export the same plan and inspect actual frames | EXP-01/02, REC-05 | Expected app actions, framing, cursor and timing; usable MP4; status reaches completion |
| Export a configured second language | EXP-04 | App-supported labels change without corrupting targets or the saved source plan |
| Cancel, restart service, or stop another app | INT-04, EXP-03/05 | Jobs terminate/report interruption correctly; unrelated app stop does not kill shared work |
| Untrusted origin or cross-app access attempt | SAFE-01 | Rejected; normal managed/attached recording flow still succeeds |

Existing tests cover portions of this matrix. Cross-app visual review, language/layout
coverage and lifecycle/recovery edge cases still require targeted regression checks
when their code changes; do not treat the entire matrix as continuously automated.

## Supported Boundaries and Known Gaps

- DOM snapshots and replay cannot reliably reconstruct arbitrary server mutations,
  canvas state, cross-origin frames or UI components lacking stable targets. Apps
  needing precise checkpoints must provide an adapter that settles before playback.
- Timeline review is action/state-based. The current panel does not expose action
  drag-reordering or encoded-frame back/forward controls. Do not advertise either
  as implemented; any addition needs its own behavior and regression criteria.
- Hover suppression covers supported effects, not every browser-native tooltip or
  arbitrary app hover implementation. Keyboard shortcuts vary by keyboard layout;
  the circle-size picker is available independently of numeric shortcuts.
- Autosave is debounced. Recovery depends on browser storage and a submitted draft;
  hard closure can lose the latest unsent edits. There is no full revision-history
  browser, collaborative merging or guarantee of recovering every failed draft.
- Session-storage, hardware-key and IndexedDB authentication may need an app-specific
  export bootstrap. Recording is not an automatic capture of an existing Chrome tab.
- Matching viewport and zoom improves fidelity but does not freeze live API data,
  responsive layouts, fonts or asynchronous rendering. Changes to an app can require
  target/state updates to its recordings.

## Future Ideas, Not Commitments

Potential follow-up work includes action drag-reordering with checkpoint recomputation,
broader visual/language regression coverage, stronger draft/revision recovery, and
explicit adapters for complex authenticated apps. These are not approved requirements
or implemented capabilities until their flows and acceptance criteria are added above.

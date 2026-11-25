# App Integration

Normal integration requires no hook: Project Studio injects the built recorder into
its managed Chrome session. See the package README for the optional state adapter.

The tracker's small development-only shortcut loader is maintained in its own
`src/LocalWalkthroughHook.tsx`. It requests an attached session from the shared
service and loads `http://127.0.0.1:3015/runtime.js`. It contains no recorder logic.

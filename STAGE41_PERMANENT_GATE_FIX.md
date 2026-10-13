# Stage 41 - Permanent Gate Route Fix

The previous V39/V40 deployment artifact used rescue scripts to work around an old route-loader/hydration failure. Those scripts could remount/clone alarm UI and were the source of the repeated DAM DANGER banners seen during Gate navigation.

V41 changes the deployment strategy for `/gate/`:

- `/gate/` is deployed as a self-contained static realtime page.
- Gate navigation is forced to a full document navigation using a capture-phase link guard.
- The Gate page performs one initial Firebase REST read and then listens with Firebase REST streaming (`EventSource`).
- It never writes control state to Firebase.
- The center spillway follows the physical SG90 angle; outer bays remain architectural visuals.
- Only one alarm banner exists; no MutationObserver/clone/rescue UI code is used.
- Service-worker registrations/caches are cleared from the standalone Gate page to prevent stale route bundles.

Source-level route stability change:

- `SiteChrome` no longer server-renders `#main-content` with `opacity: 0` and waits for client hydration to reveal it.
- Route content is visible in the static HTML immediately; motion is enhancement-only.

This avoids a blank Gate page even if client hydration or Firebase is delayed.

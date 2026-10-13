# FloodGuard Stage 40 — Gate Tab Rebuild

- Gate route no longer depends on the legacy stuck loader lifecycle in the Amplify static artifact.
- Amplify gate page mounts a dedicated V40 realtime renderer directly into #main-content.
- One initial Firebase REST read is followed by Firebase EventSource streaming.
- Center spillway follows real gate.angle (0–90).
- countdownSeconds has priority over stale gate status strings.
- 0–2° = CLOSED, >=80° = OPEN, intermediate = MOVING/CLOSING.
- Responsive CSS 3D reservoir, dam, center prototype gate, tailwater, spray and HC-SR04 beam.
- Outer gates are architectural visuals only; center gate represents the SG90 prototype.
- No fabricated rainfall or discharge measurement.

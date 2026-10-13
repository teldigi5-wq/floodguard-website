# FloodGuard Stage 29 — Responsive 3D Control Deck

Stage 29 repairs the control collision shown in the Stage 28 hydraulic command-center screenshot.

- Hydraulic Section and Presentation Mode are moved to a dedicated control row above the camera bar.
- Scene-width container queries prevent overlap inside narrow desktop cards.
- Presentation Mode is hidden when the embedded scene becomes too narrow to present it safely.
- Camera controls remain horizontally usable on compact layouts.
- Mobile keeps a compact hydraulic control without covering the live water-level card.
- Stage 28 reservoir, water-level digital twin, gate animation, Firebase live data, and hydraulic section behavior are preserved.

The project retains `amplify.yml` for AWS Amplify builds and the Next.js static-export configuration.

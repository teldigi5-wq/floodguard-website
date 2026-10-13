# FloodGuard Stage 42 — Final Website

This final website release removes the legacy Gate-route rescue/override approach and builds the site directly from the current Next.js source.

Key changes:
- rebuilt Gate page as a normal Next.js route
- no deploy-overrides or repeated alarm-banner scripts
- reconciles gate display from countdown + real gate angle
- center spillway is the only physical SG90 gate
- outer spillways are visual structure only
- improved responsive 3D digital twin, live telemetry, motion and transitions
- preserved monitoring-only architecture
- rainfall remains planned/not installed when unavailable
- no fabricated sensor data
- Firebase listener remains a single subscription to /floodguard/live
- static Amplify export is built from source and validated before packaging

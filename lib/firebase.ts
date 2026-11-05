import { getApps, initializeApp } from "firebase/app";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";

// Explicit per-deployment public parent path. Never infer a private RTDB tree.
export const LIVE_PATH = process.env.NEXT_PUBLIC_FIREBASE_LIVE_PATH ?? "floodguard/live";
// Set by next.config.ts at static build time, not a browser-selectable flag.
export const VERCEL_PREVIEW_BLOCKED = process.env.FLOODGUARD_VERCEL_PREVIEW_BLOCK === "1";

// H25: a production build can test Firebase SDK *against the localhost emulator*
// without giving a public deployment any emulator or arbitrary-host authority.
// This flag is bundled only in a dedicated disposable test build. The hostname,
// port, databaseURL, and project are all immutable and verified before connecting.
const DEMO_R3_URL = "https://demo-floodguard-r3-default-rtdb.firebasedatabase.app";
const LAB_APP_NAME = "floodguard-r3-h25-browser-lab";
let labDatabase: Database | null = null;

export function database() {
  // This is deliberately BEFORE both normal SDK and local-emulator branches.
  // A preview build cannot initialize Firebase or accidentally fall back to
  // a production URL, even if an emulator-lab flag is also present.
  if (VERCEL_PREVIEW_BLOCKED) {
    throw new Error("FloodGuard Firebase subscriptions disabled in review preview.");
  }
  // This build-time value is deliberately empty in Vercel previews, even
  // when Vercel has assigned the same public DB URL to preview/production.
  // Never reference NEXT_PUBLIC_FIREBASE_DATABASE_URL directly in client code.
  const databaseURL = process.env.FLOODGUARD_COMPILED_DATABASE_URL;
  const testLab = process.env.NEXT_PUBLIC_FG_R3_EMULATOR_LAB === "1";

  if (testLab) {
    const locallyServed = typeof window !== "undefined"
      && window.location.protocol === "http:"
      && window.location.hostname === "127.0.0.1"
      && window.location.port === "4173";
    if (!locallyServed || databaseURL !== DEMO_R3_URL
        || LIVE_PATH !== "floodguard/live") {
      throw new Error("Blocked: R3 emulator lab requires its exact loopback origin and demo database.");
    }
    if (labDatabase) return labDatabase;
    const app = getApps().find(candidate => candidate.name === LAB_APP_NAME)
      ?? initializeApp({databaseURL}, LAB_APP_NAME);
    const db = getDatabase(app);
    connectDatabaseEmulator(db, "127.0.0.1", 19001);
    labDatabase = db;
    return db;
  }

  if (!databaseURL || !/^https:\/\/[^/]+\.firebasedatabase\.app\/?$/.test(databaseURL)) {
    throw new Error("A valid Firebase Realtime Database URL is not configured.");
  }
  return getDatabase(getApps()[0] ?? initializeApp({databaseURL}));
}

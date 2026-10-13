import { getApps, initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Set explicitly per deployment. Fail safely rather than reading from an
// unrelated Firebase project when an environment variable is absent.
export const LIVE_PATH = process.env.NEXT_PUBLIC_FIREBASE_LIVE_PATH ?? "floodguard/live";

export function database() {
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  if (!databaseURL || !/^https:\/\/[^/]+\.firebasedatabase\.app\/?$/.test(databaseURL)) {
    throw new Error("A valid Firebase Realtime Database URL is not configured.");
  }
  return getDatabase(getApps()[0] ?? initializeApp({ databaseURL }));
}

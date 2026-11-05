// Public FloodGuard monitor Firebase application selection.
// Imported by the actual browser client. Pure, synchronous, and no network.
// A separate Firebase integration may initialize a default app first; never
// trust the first global app or attach FloodGuard to another project's RTDB.
export const PUBLIC_MONITOR_APP_NAME = "floodguard-public-monitor";

export function getScopedPublicMonitorApp({databaseURL,getApps,initializeApp}) {
  if(typeof databaseURL!=="string"||
     !/^https:\/\/[^/]+\.firebasedatabase\.app\/?$/.test(databaseURL))
    throw Error("Configured FloodGuard monitor database URL is invalid.");

  const existing=getApps().find(app=>app.name===PUBLIC_MONITOR_APP_NAME);
  if(existing){
    // A name collision with incompatible options must fail closed. Exact
    // matching is intentional, including trailing slash, so callers cannot
    // silently move the monitor onto a different tenant or credential config.
    const options=existing.options;
    if(!options||options.databaseURL!==databaseURL||
       Object.keys(options).some(key=>key!=="databaseURL"))
      throw Error("FloodGuard monitor app does not match configured database.");
    return existing;
  }
  return initializeApp({databaseURL},PUBLIC_MONITOR_APP_NAME);
}

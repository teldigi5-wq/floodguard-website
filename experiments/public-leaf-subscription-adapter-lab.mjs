// FloodGuard R3 preview-only subscriber adapter. NO Firebase import, URL,
// credential, background retry, publish, notification, or physical command.
// An application must inject a reviewed read-only subscription primitive.
import {
  PUBLIC_MONITOR_LAB_LEAF_PATHS,
  createPublicLeafMonitorLab,
  applyPublicLeafEventLab,
  summarizePublicLeafMonitorLab,
} from './public-leaf-monitor-lab.mjs';

const validClock = n => Number.isSafeInteger(n) && n >= 0;

export function createPublicLeafSubscriptionAdapterLab({subscribe, clock = Date.now, onUpdate} = {}) {
  if (typeof subscribe !== 'function' || typeof clock !== 'function' || typeof onUpdate !== 'function') {
    throw new TypeError('Explicit read-only subscription, clock and update callback required');
  }
  let state = createPublicLeafMonitorLab();
  let started = false;
  let cancelled = [];

  function timestamp() {
    const now = clock();
    if (!validClock(now)) throw new TypeError('Invalid browser receipt clock');
    return now;
  }
  function emit() {
    const now = timestamp();
    // Defensive copy: UI callbacks must not mutate the internal security state.
    onUpdate(Object.freeze({
      state: structuredClone(state),
      summary: Object.freeze(summarizePublicLeafMonitorLab(state, now)),
    }));
  }
  function retire() {
    started = false;
    const old = cancelled;
    cancelled = [];
    // Invalidate generation before unsubscribing: a synchronous cancel callback
    // may still run while Firebase removes an observer.
    state = applyPublicLeafEventLab(state, {kind:'disconnect', atMs:timestamp()});
    for (const unlisten of old) {
      try { unlisten(); } catch { /* cancellation failures cannot restore trust */ }
    }
    emit();
  }

  function start() {
    if (started) throw new Error('Leaf subscriptions already started');
    // Prevent a bypass via duplicate subscribe attempts / reused generators.
    const generation = state.generation;
    started = true;
    try {
      for (const path of PUBLIC_MONITOR_LAB_LEAF_PATHS) {
        // A Firebase onValue cancellation callback terminates that specific
        // listener. Ignore any subsequent queued value callback until a new
        // explicit subscription generation is established.
        let terminal = false;
        const notify = (kind, value) => {
          if (!started || state.generation !== generation ||
              (terminal && kind === 'value')) return;
          state = applyPublicLeafEventLab(state, {
            kind, path, value, atMs:timestamp(), generation,
          });
          emit();
        };
        const unlisten = subscribe(
          path,
          value => notify('value', value),
          error => {
            if (terminal) return;
            terminal = true;
            const code = error?.code;
            // Never forward provider error objects or secret-bearing URLs.
            notify(code === 'PERMISSION_DENIED' || code === 'permission_denied'
              ? 'permission_denied' : 'transport_error');
          },
        );
        if (typeof unlisten !== 'function') throw new TypeError('Missing subscription cancellation');
        cancelled.push(unlisten);
      }
      emit();
      return Object.freeze({started:true, leafCount:PUBLIC_MONITOR_LAB_LEAF_PATHS.length});
    } catch {
      // A partial subscription is not a verified public monitoring feed.
      retire();
      return Object.freeze({started:false,reason:'SUBSCRIPTION_SETUP_FAILED'});
    }
  }
  function reconnect() {
    retire();
    return start();
  }
  function stop() {
    retire();
  }
  return Object.freeze({start,stop,reconnect,
    get isStarted(){return started;},
    get current(){return Object.freeze({
      state:structuredClone(state),
      summary:Object.freeze(summarizePublicLeafMonitorLab(state, timestamp())),
    });},
  });
}

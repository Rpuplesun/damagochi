/**
 * Opt-in orchestration only: the injected client owns permission and its operation queue.
 * Call enable() directly in a click handler; call replaceState() AFTER swapping game state.
 * Status adds phase, paused and reconnectNeeded to the client's result. Stale operations
 * resolve { ok: false, stale: true } and never publish status or persist game preferences.
 */
export function createPushController({ getState, client, onStatus = () => {}, onPersist = () => {} }) {
  let generation = 0;
  let desiredEnabled = getState()?.extras?.notifications?.enabled === true;
  let enableSerial = 0;
  let syncSerial = 0;
  let enabling = null;
  let cleanup = null;
  const pendingEnables = new Set();
  const stale = () => ({ ok: false, stale: true });
  const failure = error => ({ ok: false, enabled: false, reason: error?.reason || 'sync_failed' });
  const capture = () => {
    const state = getState();
    return { generation, state, prefs: state?.extras?.notifications };
  };
  const current = target => target.generation === generation && getState() === target.state &&
    target.state?.extras?.notifications === target.prefs;
  const invoke = operation => {
    // Invoke immediately, never through a controller promise queue (permission gesture).
    try { return Promise.resolve(operation()).catch(failure); }
    catch (error) { return Promise.resolve(failure(error)); }
  };
  function publish(target, result, disabling = false) {
    if (!current(target)) return stale();
    const enabled = target.prefs?.enabled === true;
    const paused = enabled && (target.state.settings?.speed !== 1 || target.state.extras?.restUntil > Date.now());
    const reconnectNeeded = !disabling && (!result.ok || (enabled && !result.enabled));
    const status = { ...result, enabled, paused, reconnectNeeded,
      phase: disabling ? result.ok ? 'disabled' : 'disable_pending' : reconnectNeeded ? 'reconnect_needed' : paused ? 'paused' : enabled ? 'enabled' : 'disabled',
      ...(paused && !reconnectNeeded ? { reason: 'realtime_only' } : {}) };
    onStatus(status);
    return status;
  }
  function queueCleanup() {
    // Reuse cleanup only if no later enable was queued behind it. Offline retries remain possible.
    if (cleanup?.afterEnable === enableSerial) return cleanup.promise;
    const entry = { afterEnable: enableSerial, promise: invoke(() => client.disablePush()) };
    cleanup = entry;
    entry.promise.then(() => { if (cleanup === entry) cleanup = null; });
    return entry.promise;
  }
  function sync(_force = false) {
    const target = capture();
    // A pending enable always reconciles latest settings after confirmation, even while off.
    if (enabling && current(enabling)) return enabling.promise;
    if (!target.prefs?.enabled) return Promise.resolve({ ok: true, enabled: false, reason: 'not_enabled', scheduled: 0 });
    const serial = ++syncSerial;
    let request;
    try {
      const snapshot = structuredClone(target.state);
      request = invoke(() => client.syncPush(snapshot, snapshot.extras.notifications));
    } catch (error) { request = Promise.resolve(failure(error)); }
    return request.then(result => current(target) && serial === syncSerial ? publish(target, result) : stale());
  }
  function enable() {
    ++generation;
    const target = capture();
    const previouslyEnabled = target.prefs?.enabled === true;
    desiredEnabled = true;
    ++enableSerial;
    pendingEnables.add(target);
    // Pass the exact clicked state/preferences objects. The client snapshots them immediately.
    const request = invoke(() => client.enablePush(target.state, target.prefs));
    enabling = target;
    target.promise = request.then(result => {
      pendingEnables.delete(target);
      if (!current(target)) return stale();
      enabling = null;
      if (!result.ok || !result.enabled) {
        desiredEnabled = previouslyEnabled;
        target.prefs.enabled = previouslyEnabled; // A failed reconnect must not turn an old subscription off.
        onPersist();
        return publish(target, result);
      }
      target.prefs.enabled = true;
      onPersist();
      if (!current(target)) return stale();
      // Unconditional: the enable snapshot may predate rest, care, categories or a new pet.
      return sync(true);
    });
    return target.promise;
  }
  function turnOff(needsCleanup) {
    ++generation;
    const target = capture();
    desiredEnabled = false;
    enabling = null;
    if (target.prefs) target.prefs.enabled = false;
    // Queue BEFORE callbacks or returning, so the next direct enable follows this cleanup.
    const request = needsCleanup ? queueCleanup() : Promise.resolve({ ok: true, enabled: false, scheduled: 0 });
    onPersist();
    return request.then(result => publish(target, result, true));
  }
  const disable = () => turnOff(true);
  const replaceState = (hadEnabled = false) => turnOff(Boolean(hadEnabled || desiredEnabled || pendingEnables.size));
  const setPreferencesChanged = () => sync(true);
  return { enable, disable, replaceState, sync, setPreferencesChanged };
}

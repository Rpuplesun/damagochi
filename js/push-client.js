import { forecastSchedule, normalizePushPreferences } from './push-schedule.js';
export { forecastSchedule, normalizePushPreferences, PUSH_DEFAULTS } from './push-schedule.js';

export const PUSH_STORAGE_KEY = 'dotmon-push-device-v1';
const MESSAGES = {
  unsupported: '이 브라우저는 Web Push를 지원하지 않아요. 지원되는 브라우저에서 다시 시도해 주세요.',
  insecure: '푸시 알림은 HTTPS 연결에서만 사용할 수 있어요.',
  install_required: 'iPhone·iPad는 iOS 16.4 이상에서 홈 화면에 추가한 앱을 열고 알림을 켜 주세요.',
  permission_denied: '알림이 차단되어 있어요. 브라우저 또는 기기 설정에서 허용해 주세요.',
  permission_required: '알림 허용이 필요해요. 알림 켜기 버튼을 눌러 주세요.',
  server_unavailable: '푸시 서버가 연결되지 않았거나 설정되지 않았어요. 현재는 백그라운드 알림을 받을 수 없어요.',
  storage_unavailable: '기기에 푸시 연결 정보를 저장할 수 없어요. 게임 저장 데이터는 변경하지 않았어요.',
  storage_invalid: '푸시 연결 정보가 손상되었어요. 게임 저장 데이터는 변경하지 않았어요.',
  service_worker_unavailable: '서비스 워커 준비를 기다리다 중단했어요. 페이지를 새로 열고 다시 시도해 주세요.',
  subscription_failed: '푸시 구독을 만들 수 없어요. 네트워크와 브라우저 설정을 확인해 주세요.',
  sync_failed: '서버에 알림 예약을 저장하지 못했어요. 알림이 켜졌다고 보장할 수 없어요.',
  not_enabled: '백그라운드 알림이 꺼져 있어요.',
  schedule_expired: '알림 예측은 24시간만 유효해요. 게임을 다시 열어 예약을 갱신해 주세요.',
  realtime_only: '배속 모드나 휴식 중에는 백그라운드 돌봄 알림을 예약하지 않아요.',
  cooldown: '테스트 알림은 30분 간격으로 보낼 수 있어요.',
  delivery_failed: '푸시 전송 요청이 실패했어요. 기기에서의 실제 수신은 보장되지 않아요.',
  disable_pending: '기기 구독은 해제했지만 서버 예약 삭제를 확인하지 못했어요. 온라인에서 알림 끄기를 다시 눌러 주세요.',
};
class PushError extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const failure = reason => ({ ok: false, enabled: false, reason, message: MESSAGES[reason] || MESSAGES.sync_failed });
function bytesToBase64(bytes, env) {
  return env.btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64(value, env) {
  const binary = env.atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
export function createPushClient(env = globalThis, { timeoutMs = 8000 } = {}) {
  let queue = Promise.resolve();
  const enqueue = operation => {
    const result = queue.then(operation).catch(error => failure(error?.reason || 'sync_failed'));
    queue = result.then(() => {});
    return result;
  };
  const at = () => env.Date?.now?.() ?? Date.now();
  const feature = () => {
    const navigator = env.navigator || {};
    const standalone = navigator.standalone === true || env.matchMedia?.('(display-mode: standalone)')?.matches === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let reason = null;
    if (env.isSecureContext !== true) reason = 'insecure';
    else if (ios && !standalone) reason = 'install_required';
    else if (!navigator.serviceWorker || !env.PushManager || !env.Notification || !env.crypto?.getRandomValues || !env.crypto?.subtle || typeof env.Notification.requestPermission !== 'function') reason = 'unsupported';
    return { supported: !reason, standalone, ios, permission: env.Notification?.permission || 'default', reason };
  };
  const storage = () => {
    try {
      const value = env.localStorage;
      if (!value || typeof value.getItem !== 'function' || typeof value.setItem !== 'function') throw new Error();
      return value;
    } catch { throw new PushError('storage_unavailable'); }
  };
  const save = value => {
    try {
      const local = storage();
      const serialized = JSON.stringify(value);
      local.setItem(PUSH_STORAGE_KEY, serialized);
      if (local.getItem(PUSH_STORAGE_KEY) !== serialized) throw new Error();
    } catch { throw new PushError('storage_unavailable'); }
  };
  async function identity(create = false) {
    let raw;
    try { raw = storage().getItem(PUSH_STORAGE_KEY); } catch { throw new PushError('storage_unavailable'); }
    let device;
    if (raw !== null) {
      try {
        if (raw.length > 2048) throw new Error();
        device = JSON.parse(raw);
        if (device?.version !== 1 || !/^[a-f0-9]{64}$/.test(device.deviceId) || !/^[A-Za-z0-9_-]{43}$/.test(device.token) || typeof device.enabled !== 'boolean') throw new Error();
        const bytes = fromBase64(device.token, env);
        if (bytes.length !== 32 || bytesToBase64(bytes, env) !== device.token) throw new Error();
        const digest = new Uint8Array(await env.crypto.subtle.digest('SHA-256', bytes));
        if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== device.deviceId) throw new Error();
        return device;
      } catch { throw new PushError('storage_invalid'); }
    }
    if (!create) return null;
    const bytes = env.crypto.getRandomValues(new Uint8Array(32));
    const digest = new Uint8Array(await env.crypto.subtle.digest('SHA-256', bytes));
    device = { version: 1, deviceId: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), token: bytesToBase64(bytes, env), enabled: false, syncedAt: 0, expiresAt: 0 };
    save(device); // Persist the secret BEFORE creating a remote subscription; never touch game keys.
    return device;
  }
  async function request(endpoint, payload, device) {
    const controller = new env.AbortController();
    let timer;
    try {
      const task = env.fetch(`/api/push/${endpoint}`, { method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', mode: 'same-origin', cache: 'no-store',
        headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...(device ? { Authorization: `Bearer ${device.token}` } : {}) },
        ...(payload === undefined ? {} : { body: JSON.stringify({ ...payload, ...(device ? { deviceId: device.deviceId } : {}) }) }), signal: controller.signal });
      const response = await Promise.race([task, new Promise((_, reject) => {
        timer = env.setTimeout(() => { controller.abort(); reject(new PushError('server_unavailable')); }, timeoutMs);
      })]);
      const data = await response.json();
      if (!response.ok) throw new PushError(data.error === 'cooldown' ? 'cooldown' : data.error === 'delivery_failed' ? 'delivery_failed' : endpoint === 'config' ? 'server_unavailable' : 'sync_failed');
      return data;
    } catch (error) { throw error instanceof PushError ? error : new PushError('server_unavailable'); }
    finally { if (timer) env.clearTimeout(timer); }
  }
  async function configuration() {
    const config = await request('config');
    if (!config.available || typeof config.publicKey !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(config.publicKey)) throw new PushError('server_unavailable');
    let bytes;
    try { bytes = fromBase64(config.publicKey, env); } catch { throw new PushError('server_unavailable'); }
    if (bytes.length !== 65 || bytes[0] !== 4) throw new PushError('server_unavailable');
    return { ...config, keyBytes: bytes };
  }
  async function registration() {
    let timer;
    try {
      const ready = await Promise.race([env.navigator.serviceWorker.ready, new Promise((_, reject) => {
        timer = env.setTimeout(() => reject(new PushError('service_worker_unavailable')), timeoutMs);
      })]);
      if (!ready?.pushManager) throw new PushError('service_worker_unavailable');
      return ready;
    } finally { if (timer) env.clearTimeout(timer); }
  }
  const check = () => { const status = feature(); if (!status.supported) throw new PushError(status.reason); return status; };
  const snapshot = state => { try { return structuredClone(state); } catch { return null; } };
  async function syncInternal(state, prefs, device, subscription) {
    const enabled = normalizePushPreferences(prefs).enabled;
    const events = forecastSchedule(state, prefs, { now: at() });
    const response = await request('sync', { subscription: subscription.toJSON(), publicKey: device.publicKey, events }, device);
    device.enabled = enabled;
    device.syncedAt = response.syncedAt || at();
    device.expiresAt = response.expiresAt || at() + 7 * 86_400_000;
    device.forecastUntil = at() + 86_400_000;
    device.scheduled = response.scheduled;
    save(device);
    const paused = state?.settings?.speed !== 1 || state?.extras?.restUntil > at();
    return { ok: true, enabled, subscribed: true, scheduled: response.scheduled, syncedAt: device.syncedAt, expiresAt: device.expiresAt,
      reason: paused ? 'realtime_only' : null, ...(paused ? { message: MESSAGES.realtime_only } : {}) };
  }
  function enablePush(state, prefs = state?.extras?.notifications) {
    // This call deliberately occurs BEFORE ANY await, queue, storage read or network request.
    let permission;
    try {
      const status = check();
      if (status.permission === 'denied') return Promise.resolve(failure('permission_denied'));
      permission = status.permission === 'granted' ? Promise.resolve('granted') : env.Notification.requestPermission();
    } catch (error) { return Promise.resolve(failure(error.reason || 'permission_denied')); }
    // Attach a rejection handler immediately; user permission may settle while earlier sync work runs.
    const granted = Promise.resolve(permission).then(value => value, () => 'denied');
    const copy = snapshot(state);
    const preferences = { ...normalizePushPreferences(prefs), enabled: true };
    return enqueue(async () => {
      if (await granted !== 'granted') throw new PushError('permission_denied');
      const config = await configuration();
      const device = await identity(true);
      const ready = await registration();
      let subscription = await ready.pushManager.getSubscription();
      if (subscription && device.publicKey && device.publicKey !== config.publicKey) {
        await request('unsubscribe', {}, device);
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        try { subscription = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: config.keyBytes }); }
        catch { throw new PushError('subscription_failed'); }
      }
      device.publicKey = config.publicKey;
      return syncInternal(copy, preferences, device, subscription);
    });
  }
  function syncPush(state, prefs = state?.extras?.notifications) {
    const copy = snapshot(state);
    const preferences = normalizePushPreferences(prefs);
    return enqueue(async () => {
      check();
      const device = await identity();
      if (!device?.enabled) return { ok: true, enabled: false, reason: 'not_enabled', scheduled: 0 };
      if (!preferences.enabled) return disableInternal(device);
      if (env.Notification.permission !== 'granted') throw new PushError(env.Notification.permission === 'denied' ? 'permission_denied' : 'permission_required');
      const ready = await registration();
      const subscription = await ready.pushManager.getSubscription();
      if (!subscription) throw new PushError('not_enabled');
      return syncInternal(copy, preferences, device, subscription);
    });
  }
  async function disableInternal(device) {
    if (!device) return { ok: true, enabled: false, subscribed: false, scheduled: 0 };
    let deleted = !device;
    if (device) {
      // Preserve the identity for retrying remote cleanup, including after offline unsubscribe.
      device.enabled = false;
      save(device);
      try { await request('unsubscribe', {}, device); deleted = true; } catch { /* Still cancel browser delivery. */ }
    }
    try {
      if (env.navigator?.serviceWorker) {
        const ready = await registration();
        const subscription = await ready.pushManager.getSubscription();
        if (subscription && await subscription.unsubscribe() === false) deleted = false;
      }
    } catch { deleted = false; }
    return deleted ? { ok: true, enabled: false, subscribed: false, scheduled: 0 } : failure('disable_pending');
  }
  const disablePush = () => enqueue(async () => disableInternal(await identity()));
  const testPush = state => enqueue(async () => {
    check();
    const device = await identity();
    if (!device?.enabled) throw new PushError('not_enabled');
    await configuration();
    const response = await request('test', { petId: state?.pet?.id }, device);
    return { ok: true, enabled: true, requested: response.ok === true, message: '푸시 전송 요청을 보냈어요. 기기의 알림 설정에 따라 실제 표시가 달라질 수 있어요.' };
  });
  async function inspectPushStatus() {
    const status = feature();
    const base = { ...status, enabled: false, subscribed: false, serverAvailable: false, scheduled: 0 };
    if (!status.supported) return { ...base, message: MESSAGES[status.reason] };
    try {
      await configuration();
      base.serverAvailable = true;
      const device = await identity();
      const ready = await registration();
      const subscription = await ready.pushManager.getSubscription();
      base.subscribed = Boolean(subscription);
      base.scheduled = device?.scheduled || 0;
      base.syncedAt = device?.syncedAt || 0;
      base.expiresAt = device?.expiresAt || 0;
      const expired = device?.forecastUntil && device.forecastUntil <= at();
      base.enabled = Boolean(device?.enabled && subscription && status.permission === 'granted' && !expired);
      const reason = status.permission === 'denied' ? 'permission_denied' : expired ? 'schedule_expired' : base.enabled ? null : 'not_enabled';
      return { ...base, reason, ...(reason ? { message: MESSAGES[reason] } : {}) };
    } catch (error) { const reason = error.reason || 'server_unavailable'; return { ...base, reason, message: MESSAGES[reason] }; }
  }
  return { inspectPushStatus, enablePush, syncPush, disablePush, testPush };
}
const client = createPushClient();
export const inspectPushStatus = (...args) => client.inspectPushStatus(...args);
export const enablePush = (...args) => client.enablePush(...args);
export const syncPush = (...args) => client.syncPush(...args);
export const disablePush = (...args) => client.disablePush(...args);
export const testPush = (...args) => client.testPush(...args);

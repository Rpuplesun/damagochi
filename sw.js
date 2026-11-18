// 런타임 파일을 바꾼 뒤 node scripts/generate-precache.js 를 실행한다.
// 완전한 revision만 활성화한다. 현재 페이지를 새 워커로 강제 전환하지 않는다.
const CACHE_PREFIX = 'dotmon-shell-';
const VERSION = 'v4';
// BEGIN GENERATED PRECACHE
const PRECACHE = {
  "revision": "842e4dd17430fdd534b4",
  "files": [
    "./",
    "assets/fonts/Galmuri11-Bold.woff2",
    "assets/fonts/Galmuri11.woff2",
    "assets/monsters/buglord_1.gif",
    "assets/monsters/buglord_2.gif",
    "assets/monsters/egg_1.gif",
    "assets/monsters/grove_1.gif",
    "assets/monsters/grove_2.gif",
    "assets/monsters/jellion_1.gif",
    "assets/monsters/jellion_2.gif",
    "assets/monsters/kara_1.gif",
    "assets/monsters/kara_2.gif",
    "assets/monsters/monggle_1.gif",
    "assets/monsters/monggle_2.gif",
    "assets/monsters/mungchi_1.gif",
    "assets/monsters/mungchi_2.gif",
    "assets/monsters/mush_1.gif",
    "assets/monsters/mush_2.gif",
    "assets/monsters/noise_1.gif",
    "assets/monsters/noise_2.gif",
    "assets/monsters/piko_1.gif",
    "assets/monsters/piko_2.gif",
    "assets/monsters/raiga_1.gif",
    "assets/monsters/raiga_2.gif",
    "assets/monsters/ttol_1.gif",
    "assets/monsters/ttol_2.gif",
    "assets/monsters/ttolttol_1.gif",
    "assets/monsters/ttolttol_2.gif",
    "assets/monsters/volt_1.gif",
    "assets/monsters/volt_2.gif",
    "css/style.css",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "index.html",
    "js/battle.js",
    "js/care.js",
    "js/config.js",
    "js/digimon-assets.js",
    "js/game.js",
    "js/lcd.js",
    "js/main.js",
    "js/push-client.js",
    "js/push-controller.js",
    "js/push-schedule.js",
    "js/rng.js",
    "js/scenes.js",
    "js/share.js",
    "js/sound.js",
    "js/species.js",
    "js/sprites.js",
    "js/storage.js",
    "manifest.webmanifest",
    "sw.js",
    "precache.json"
  ]
};
// END GENERATED PRECACHE
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}-${PRECACHE.revision}`;
const BASE_URL = new URL('./', self.location.href);
const INDEX_URL = new URL('index.html', BASE_URL).href;
const ROOT_URL = BASE_URL.href;
const ASSET_URLS = new Set(PRECACHE.files.map(file => new URL(file, BASE_URL).href));
const NAVIGATION_PATHS = new Set([BASE_URL.pathname, new URL(INDEX_URL).pathname]);

function cacheable(response, requestURL) {
  if (!response || response.status !== 200 || !response.ok || response.redirected) return false;
  if (!['basic', 'default'].includes(response.type)) return false;
  if (response.url && new URL(response.url).origin !== BASE_URL.origin) return false;
  const control = response.headers.get('Cache-Control') || '';
  if (/(?:^|[,\s])(?:private|no-store)(?:[=,\s]|$)/i.test(control)) return false;
  if (response.headers.get('Set-Cookie') || response.headers.get('Vary')?.includes('*')) return false;
  const mime = response.headers.get('Content-Type') || '';
  const isPage = NAVIGATION_PATHS.has(new URL(requestURL).pathname);
  if (isPage && !/^text\/html(?:;|$)/i.test(mime)) return false;
  if (!isPage && /^text\/html(?:;|$)/i.test(mime)) return false;
  return true;
}

function offlineResponse() {
  return new Response('오프라인 파일을 사용할 수 없어요. 인터넷에 연결한 뒤 다시 열어 주세요.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (!PRECACHE.files.includes('index.html') || PRECACHE.revision === 'unbuilt') {
      throw new Error('Precache not built: run node scripts/generate-precache.js --strict');
    }
    const cache = await caches.open(CACHE_NAME);
    try {
      await Promise.all(PRECACHE.files.map(async file => {
        const url = new URL(file, BASE_URL).href;
        const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
        if (!cacheable(response, url)) throw new Error(`Cannot precache ${file}: ${response.status}`);
        await cache.put(url, response);
      }));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // Default waiting-worker lifecycle: old pages keep their coherent revision.
    // No skipWaiting(): the complete new revision activates after old tabs close.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    // No clients.claim(): don't pair an already-loaded HTML page with new modules.
  })());
});

async function shellResponse() {
  try {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(INDEX_URL) || await cache.match(ROOT_URL) || offlineResponse();
  } catch { return offlineResponse(); }
}

async function staticResponse(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    // Cache is immutable after install. Fetching an individual missing asset from
    // a newer deployment would mix revisions, so require a complete reinstall.
    return await cache.match(request.url) || offlineResponse();
  } catch { return offlineResponse(); }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Authorization') || request.headers.has('Range')) return;
  const url = new URL(request.url);
  if (url.origin !== BASE_URL.origin || !url.pathname.startsWith(BASE_URL.pathname)) return;
  if (request.mode === 'navigate') {
    if (!NAVIGATION_PATHS.has(url.pathname)) return;
    event.respondWith(shellResponse());
    return;
  }
  if (url.search || !ASSET_URLS.has(url.href)) return;
  event.respondWith(staticResponse(request));
});

const CARE_ACTIONS = new Set(['feed', 'vitamin', 'clean', 'heal', 'lights', 'open']);
function notificationData(raw = {}) {
  const safeText = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, max) : '';
  const petId = safeText(raw.petId, 64);
  let care = 'open';
  try {
    const url = new URL(raw.url || './', BASE_URL);
    if (url.origin === BASE_URL.origin && NAVIGATION_PATHS.has(url.pathname) && CARE_ACTIONS.has(url.searchParams.get('care'))) care = url.searchParams.get('care');
  } catch { /* Bad payload URLs never escape this game origin. */ }
  return {
    title: safeText(raw.title, 80) || '도트몬 돌보기', body: safeText(raw.body, 200) || '디지몬의 상태를 확인해 주세요.',
    id: safeText(raw.id, 100), tag: safeText(raw.tag, 100) || 'dotmon-care', petId, care,
    actions: Array.isArray(raw.actions) ? raw.actions.slice(0, 2).filter(item => item && CARE_ACTIONS.has(item.action))
      .map(item => ({ action: item.action, title: safeText(item.title, 40) || '돌보러 가기' })) : [],
  };
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let raw = {};
    try { raw = event.data?.json() || {}; } catch { /* Show a safe generic message. */ }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
    const data = notificationData(raw);
    await self.registration.showNotification(data.title, {
      body: data.body, icon: new URL('icons/icon-192.png', BASE_URL).href,
      badge: new URL('icons/icon-192.png', BASE_URL).href,
      tag: data.tag, actions: data.actions, data, renotify: false,
    });
    try { await self.navigator?.setAppBadge?.(1); } catch { /* Optional OS badge. */ }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = notificationData(event.notification.data || {});
    const original = event.notification.data || {};
    const action = CARE_ACTIONS.has(event.action) ? event.action : CARE_ACTIONS.has(original.care) ? original.care : data.care;
    const target = new URL('./', BASE_URL);
    target.searchParams.set('care', action);
    if (data.petId) target.searchParams.set('pet', data.petId);
    if (data.id) target.searchParams.set('notice', data.id);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => {
      const url = new URL(client.url);
      return url.origin === BASE_URL.origin && url.pathname.startsWith(BASE_URL.pathname);
    });
    if (existing) {
      existing.postMessage?.({ type: 'DOTMON_CARE', care: action, petId: data.petId });
      await existing.focus();
      return;
    }
    return self.clients.openWindow(target.href);
  })());
});

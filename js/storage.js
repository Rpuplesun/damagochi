// v1 세이브만 취급한다. 초기 v1의 종 ID(똘·피코 등)는 읽을 때 현재 디지몬 키로 바꾼다. 손상된 원본은 자동 저장으로 덮어쓰지 않는다.
import { SAVE_VERSION, DEFAULT_SETTINGS, MAX_HEARTS, POOP_MAX } from './config.js';
import { createPet, createState } from './game.js';
import { SPECIES, LEGACY_SPECIES, canonicalSpecies, inferTree, isKnownTree } from './species.js';
import { normalizeExtras } from './care.js';

export const SAVE_KEY = 'dotmon-save';
export const BACKUP_KEY = 'dotmon-save-backup';
export const MAX_SAVE_CHARS = 128 * 1024;
const MAX_TIME = 8_640_000_000_000_000; // JavaScript Date의 유효 범위
const MAX_COUNTER = 10_000_000;
const MAX_WEIGHT = 100_000;
const MAX_RECORDS = 50;
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const knownSpecies = (id) => typeof id === 'string' && (has(SPECIES, id) || has(LEGACY_SPECIES, id));
const DEX_KEYS = [...Object.keys(SPECIES), ...Object.keys(LEGACY_SPECIES)];
const time = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TIME;
const integer = (value, max = MAX_COUNTER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const text = (value, max, empty = true) => typeof value === 'string' && value.length <= max && (empty || value.length > 0) && !/[\u0000-\u001f\u007f]/u.test(value);
const PET_COUNTERS = [
  'ageMin', 'stageMin', 'hungerTimer', 'strengthTimer', 'poopTimer',
  'hungerZeroMin', 'strengthZeroMin', 'sickMin', 'sleepMin', 'mistakes',
  'stageMistakes', 'trainTotal', 'stageTrain', 'overfeed', 'battles',
  'wins', 'stageBattles', 'stageWins',
];
const PET_BOOLEANS = ['sick', 'asleep', 'lightsOn', 'lightsPenalized', 'dead'];
const PET_KEYS = [
  'id', 'name', 'species', 'tree', 'path', 'bornAt', 'hunger', 'strength', 'weight',
  'poop', 'deathCause', 'diedAt', ...PET_COUNTERS, ...PET_BOOLEANS,
];
const RECORD_KEYS = ['name', 'species', 'path', 'bornAt', 'endedAt', 'ageMin', 'cause', 'battles', 'wins', 'mistakes'];

let status = { available: null, canSave: true, recovered: false, reason: 'uninitialized' };
function setStatus(reason, available = true, canSave = false, recovered = false) {
  status = { available, canSave, recovered, reason };
}
/** reason: new/ready/recovered/corrupt/unavailable/read-failed/quota/write-failed/invalid-state/cleared/clear-failed. */
export function getStorageStatus() {
  return { ...status };
}

// JSON 모양의 자체 데이터 속성만 허용한다. getter와 사용자 프로토타입은 실행하지 않는다.
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > keys.length) return false;
  return ownKeys.every((key) => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && has(descriptor, 'value');
  });
}
function list(value, max = MAX_RECORDS) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return false; // 희소 배열/사용자 속성도 거부
  return keys.every((key) => {
    if (key === 'length') return true;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && has(descriptor, 'value');
  });
}
function path(value, species) {
  if (value === undefined) return [species];
  if (!list(value) || value.length === 0 || !value.every(knownSpecies)) return null;
  return value.map(canonicalSpecies);
}
function normalizePet(raw, now) {
  if (!record(raw, PET_KEYS) || !has(raw, 'species') || !knownSpecies(raw.species)) return null;
  const pet = createPet(now);
  for (const key of PET_KEYS) {
    if (!has(raw, key)) continue;
    const value = raw[key];
    if (PET_COUNTERS.includes(key) && !integer(value)) return null;
    if (PET_BOOLEANS.includes(key) && typeof value !== 'boolean') return null;
    if (key === 'id' && !text(value, 64, false)) return null;
    if (key === 'name' && !text(value, 8)) return null;
    if (key === 'bornAt' && !time(value)) return null;
    if ((key === 'hunger' || key === 'strength') && !integer(value, MAX_HEARTS)) return null;
    if (key === 'weight' && !integer(value, MAX_WEIGHT)) return null;
    if (key === 'poop' && !integer(value, POOP_MAX)) return null;
    if (key === 'deathCause' && value !== null && !['starve', 'sick'].includes(value)) return null;
    if (key === 'diedAt' && value !== null && !time(value)) return null;
    if (key === 'path' && (!list(value) || !value.length || !value.every(knownSpecies))) return null;
    if (key === 'tree' && !isKnownTree(value)) return null;
    pet[key] = value;
  }
  pet.species = canonicalSpecies(pet.species);
  // 트리 정보가 없던 세이브는 지금 종이 속한 트리에서 이어서 자란다.
  if (!has(raw, 'tree')) pet.tree = inferTree(pet.species);
  pet.path = path(has(raw, 'path') ? raw.path : undefined, pet.species);
  if (!pet.path || pet.wins > pet.battles || pet.stageWins > pet.stageBattles) return null;
  if (pet.dead && (pet.deathCause === null || pet.diedAt === null)) return null;
  if (!pet.dead && (pet.deathCause !== null || pet.diedAt !== null)) return null;
  return pet;
}
function normalizeSettings(raw) {
  if (!record(raw, Object.keys(DEFAULT_SETTINGS))) return null;
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if ((key === 'sleepHour' || key === 'wakeHour') && !integer(value, 23)) return null;
    if (key === 'speed' && ![1, 10, 60, 600].includes(value)) return null;
    if (key === 'sound' && typeof value !== 'boolean') return null;
    settings[key] = value;
  }
  return settings;
}
function normalizeDex(raw) {
  if (!record(raw, DEX_KEYS)) return null;
  const dex = {};
  for (const id of Object.keys(raw)) {
    if (!knownSpecies(id) || !time(raw[id])) return null;
    const key = canonicalSpecies(id);
    dex[key] = has(dex, key) ? Math.min(dex[key], raw[id]) : raw[id];
  }
  return dex;
}
function normalizeRecord(raw, now) {
  if (!record(raw, RECORD_KEYS) || !has(raw, 'species') || !knownSpecies(raw.species)) return null;
  const entry = { name: '', species: raw.species, path: [raw.species], bornAt: now, endedAt: now, ageMin: 0, cause: 'farewell', battles: 0, wins: 0, mistakes: 0 };
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (key === 'name' && !text(value, 8)) return null;
    if (['bornAt', 'endedAt'].includes(key) && !time(value)) return null;
    if (['ageMin', 'battles', 'wins', 'mistakes'].includes(key) && !integer(value)) return null;
    if (key === 'cause' && !['starve', 'sick', 'farewell'].includes(value)) return null;
    if (key === 'path' && (!list(value) || !value.length || !value.every(knownSpecies))) return null;
    entry[key] = value;
  }
  entry.species = canonicalSpecies(entry.species);
  entry.path = path(has(raw, 'path') ? raw.path : undefined, entry.species);
  if (!entry.path || entry.wins > entry.battles) return null;
  return entry;
}

/** 버전 없는 초기 v1/버전 0/v1의 빠진 필드를 채운다. v2와 미래 형식은 거부한다. */
export function migrate(raw, now = Date.now()) {
  try {
    if (!time(now) || !record(raw, ['v', 'clock', 'lastReal', 'settings', 'pet', 'dex', 'graveyard', 'extras'])) return null;
    if (has(raw, 'v') && ![0, SAVE_VERSION].includes(raw.v)) return null;
    // 빈 객체나 다른 데이터가 새 세이브로 오인되는 것을 막는다.
    if (!has(raw, 'pet')) return null;
    const pet = normalizePet(raw.pet, now);
    if (!pet) return null;
    const state = { v: SAVE_VERSION, clock: now, lastReal: now, settings: { ...DEFAULT_SETTINGS }, pet, dex: { egg: now }, graveyard: [] };
    for (const key of ['clock', 'lastReal']) {
      if (has(raw, key)) {
        if (!time(raw[key])) return null;
        state[key] = raw[key];
      }
    }
    if (has(raw, 'settings')) {
      state.settings = normalizeSettings(raw.settings);
      if (!state.settings) return null;
    }
    if (has(raw, 'dex')) {
      state.dex = normalizeDex(raw.dex);
      if (!state.dex) return null;
    }
    if (has(raw, 'graveyard')) {
      if (!list(raw.graveyard)) return null;
      for (const entry of raw.graveyard) {
        const normalized = normalizeRecord(entry, now);
        if (!normalized) return null;
        state.graveyard.push(normalized);
      }
    }
    if (has(raw, 'extras')) {
      state.extras = normalizeExtras(raw.extras, now);
      if (!state.extras) return null;
    }
    // 문자열 제한뿐 아니라 정규화된 객체의 전체 크기도 제한한다.
    if (JSON.stringify(state).length > MAX_SAVE_CHARS) return null;
    return state;
  } catch {
    return null;
  }
}

function storageAccess() {
  // localStorage getter 자체가 SecurityError를 던질 수 있으므로 기본 인수로 접근하지 않는다.
  const storage = globalThis.localStorage;
  if (!storage || !['getItem', 'setItem', 'removeItem'].every((key) => typeof storage[key] === 'function')) {
    throw new Error('Storage unavailable');
  }
  return storage;
}
function readSlot(storage, key, now) {
  const value = storage.getItem(key);
  if (value === null) return { present: false, text: null, state: null };
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SAVE_CHARS) {
    return { present: true, text: value, state: null };
  }
  try {
    return { present: true, text: value, state: migrate(JSON.parse(value), now) };
  } catch {
    return { present: true, text: value, state: null };
  }
}
const corrupt = (slot) => slot.present && !slot.state;
function isQuota(error) {
  return error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014;
}

/** 항상 플레이 가능한 상태를 반환한다. 복구/실패 정보는 getStorageStatus()에서 확인한다. */
export function loadState(now = Date.now()) {
  const at = time(now) ? now : Date.now();
  let storage;
  try {
    storage = storageAccess();
  } catch {
    setStatus('unavailable', false);
    return createState(at);
  }
  try {
    const primary = readSlot(storage, SAVE_KEY, at);
    const backup = readSlot(storage, BACKUP_KEY, at);
    if (primary.state) {
      setStatus(corrupt(backup) ? 'corrupt' : 'ready', true, !corrupt(backup));
      return primary.state;
    }
    if (backup.state) {
      // 손상 원본은 그대로 둔다. 자동 저장도 차단해 사용자가 명시적으로 초기화할 수 있게 한다.
      setStatus('recovered', true, !corrupt(primary), true);
      return backup.state;
    }
    const broken = corrupt(primary) || corrupt(backup);
    setStatus(broken ? 'corrupt' : 'new', true, !broken);
  } catch {
    setStatus('read-failed', true);
  }
  return createState(at);
}

/** 성공한 경우에만 true. 손상된 슬롯은 clearState()로 명시적으로 지운 뒤 저장해야 한다. */
export function saveState(state) {
  const normalized = migrate(state);
  if (!normalized) {
    setStatus('invalid-state', status.available, status.canSave, status.recovered);
    return false;
  }
  let storage;
  try {
    storage = storageAccess();
  } catch {
    setStatus('unavailable', false);
    return false;
  }
  let primary;
  let backup;
  try {
    primary = readSlot(storage, SAVE_KEY, normalized.clock);
    backup = readSlot(storage, BACKUP_KEY, normalized.clock);
    if (corrupt(primary) || corrupt(backup)) {
      setStatus(status.recovered ? 'recovered' : 'corrupt', true, false, status.recovered);
      return false;
    }
  } catch {
    setStatus('read-failed', true);
    return false;
  }
  try {
    const serialized = JSON.stringify(normalized);
    // 먼저 직전 유효 세이브를 보관한다. quota 실패 때 현재 원본은 손상되지 않는다.
    const previous = primary.state || backup.state || normalized;
    storage.setItem(BACKUP_KEY, JSON.stringify(previous));
    storage.setItem(SAVE_KEY, serialized);
    setStatus('ready', true, true);
    return true;
  } catch (error) {
    setStatus(isQuota(error) ? 'quota' : 'write-failed', true);
    return false;
  }
}

/** 이 게임의 두 키만 제거한다. 다른 앱의 localStorage는 건드리지 않는다. */
export function clearState() {
  let storage;
  try {
    storage = storageAccess();
  } catch {
    setStatus('unavailable', false);
    return false;
  }
  try {
    // 백업부터 지워 부분 실패 시 초기화한 데이터가 백업으로 되살아나는 것을 피한다.
    storage.removeItem(BACKUP_KEY);
    storage.removeItem(SAVE_KEY);
    setStatus('cleared', true, true);
    return true;
  } catch {
    setStatus('clear-failed', true);
    return false;
  }
}

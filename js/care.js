// Optional companion data: does not alter combat or the original evolution rules.
import { stageCfg, minutesToEvolve } from './game.js';
import { speciesOf } from './species.js';

export const THEMES = ['moss', 'cobalt', 'amber'];
export const CATEGORIES = ['hunger', 'strength', 'clean', 'sick', 'lights', 'evolve'];
export const TASKS = [
  { id: 'feed', label: '식사 챙기기', goal: 3 },
  { id: 'clean', label: '청소하기', goal: 1 },
  { id: 'train', label: '훈련 성공', goal: 1 },
  { id: 'play', label: '함께 놀기', goal: 1 },
];
const ACTS = ['feed', 'vitamin', 'clean', 'heal', 'lights', 'train', 'battle', 'play', 'hatch', 'evolve', 'death', 'rest', 'resume', 'new'];
const safeNumber = (n, max = 8.64e15) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const safeObject = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
  Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key) && 'value' in Object.getOwnPropertyDescriptor(value, key));
const safeString = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

export function dayKey(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function createExtras(at = Date.now()) {
  return {
    version: 1, petId: '', bond: 0, lastPlayAt: 0,
    theme: 'moss', reducedMotion: false, restUntil: 0, restRemainder: 0,
    daily: { date: dayKey(at), counts: { feed: 0, clean: 0, train: 0, play: 0 } },
    journal: [],
    notifications: { enabled: false, quietStart: 23, quietEnd: 7,
      categories: Object.fromEntries(CATEGORIES.map(key => [key, true])) },
  };
}
export function normalizeExtras(raw, at = Date.now()) {
  try {
    const keys = Object.keys(createExtras(at));
    if (!safeObject(raw, keys) || raw.version !== 1 || !safeString(raw.petId, 64) ||
        !Number.isInteger(raw.bond) || !safeNumber(raw.bond, 100) || !safeNumber(raw.lastPlayAt) ||
        !THEMES.includes(raw.theme) || typeof raw.reducedMotion !== 'boolean' || !safeNumber(raw.restUntil)) return null;
    if (own(raw, 'restRemainder') && (!safeNumber(raw.restRemainder) || raw.restRemainder >= 60000)) return null;
    if (!safeObject(raw.daily, ['date', 'counts']) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.daily.date) ||
        !safeObject(raw.daily.counts, TASKS.map(task => task.id))) return null;
    for (const task of TASKS) if (!own(raw.daily.counts, task.id) || !Number.isInteger(raw.daily.counts[task.id]) ||
      !safeNumber(raw.daily.counts[task.id], task.goal)) return null;
    if (!Array.isArray(raw.journal) || Object.getPrototypeOf(raw.journal) !== Array.prototype || raw.journal.length > 80 ||
        Reflect.ownKeys(raw.journal).length !== raw.journal.length + 1 ||
        !Reflect.ownKeys(raw.journal).every(key => key === 'length' ||
          typeof key === 'string' && /^(0|[1-9]\d*)$/u.test(key) && Number(key) < raw.journal.length &&
          'value' in Object.getOwnPropertyDescriptor(raw.journal, key))) return null;
    for (const entry of raw.journal) if (!safeObject(entry, ['at', 'action', 'label', 'petId']) ||
      !safeNumber(entry.at) || !ACTS.includes(entry.action) || !safeString(entry.label, 120) || !safeString(entry.petId, 64)) return null;
    const prefs = raw.notifications;
    if (!safeObject(prefs, ['enabled', 'quietStart', 'quietEnd', 'categories']) || typeof prefs.enabled !== 'boolean' ||
      !Number.isInteger(prefs.quietStart) || !safeNumber(prefs.quietStart, 23) ||
      !Number.isInteger(prefs.quietEnd) || !safeNumber(prefs.quietEnd, 23) ||
      !safeObject(prefs.categories, CATEGORIES) || !CATEGORIES.every(key => typeof prefs.categories[key] === 'boolean')) return null;
    return { ...JSON.parse(JSON.stringify(raw)), restRemainder: raw.restRemainder ?? 0 };
  } catch { return null; }
}
export function ensureExtras(state, at = Date.now()) {
  if (!state.extras) state.extras = createExtras(at);
  const extras = state.extras;
  if (extras.petId !== state.pet?.id) {
    extras.petId = state.pet?.id || '';
    extras.bond = 0;
    extras.lastPlayAt = 0;
    extras.restUntil = 0;
    extras.restRemainder = 0;
  }
  if (extras.daily.date !== dayKey(at)) {
    extras.daily = createExtras(at).daily;
  }
  return extras;
}
export function logCare(state, action, label, at = Date.now()) {
  if (!ACTS.includes(action)) return;
  const extras = ensureExtras(state, at);
  const previous = extras.journal[0];
  if (previous?.action === action && previous.petId === extras.petId && previous.at === at && previous.label === label) return;
  extras.journal.unshift({ at, action, label: String(label).replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 120), petId: extras.petId });
  extras.journal.length = Math.min(80, extras.journal.length);
  const task = TASKS.find(task => task.id === action);
  if (task) extras.daily.counts[action] = Math.min(task.goal, extras.daily.counts[action] + 1);
  if (['feed', 'vitamin', 'clean', 'heal', 'train', 'play'].includes(action)) extras.bond = Math.min(100, extras.bond + (action === 'play' ? 3 : 1));
}
export function playWithPet(state, at = Date.now()) {
  const pet = state.pet;
  const extras = ensureExtras(state, at);
  if (!pet || pet.dead || pet.species === 'egg') return { ok: false, reason: 'egg' };
  if (pet.asleep) return { ok: false, reason: 'asleep' };
  if (pet.sick) return { ok: false, reason: 'sick' };
  if (extras.lastPlayAt && at - extras.lastPlayAt < 60_000) return { ok: false, reason: 'cooldown', left: Math.ceil((60_000 - (at - extras.lastPlayAt)) / 1000) };
  extras.lastPlayAt = at;
  logCare(state, 'play', '함께 놀고 친밀도가 올랐어요', at);
  return { ok: true, bond: extras.bond };
}
export function moodOf(pet, extras) {
  if (!pet || pet.dead) return '추억 속에';
  if (pet.species === 'egg') return '두근두근';
  if (pet.asleep) return '꿈꾸는 중';
  if (pet.sick) return '돌봄이 필요해요';
  if (!pet.hunger) return '배가 고파요';
  if (!pet.strength) return '기운이 없어요';
  if (pet.poop >= 2) return '깨끗한 방이 좋아요';
  if (extras?.bond >= 30) return '함께라서 행복해요';
  return '기분 좋아요';
}
export function growthInfo(pet) {
  if (!pet || pet.dead) return { percent: 0, left: null, label: '새 알로 다시 시작해요' };
  const cfg = stageCfg(pet.species);
  const left = minutesToEvolve(pet);
  const percent = left === null ? 100 : Math.min(100, Math.floor(pet.stageMin / cfg.duration * 100));
  let label = left === null ? '최종 단계에 도착했어요' : left === 0 ? '진화 조건을 채우면 진화해요' : `진화까지 게임 시간 ${left >= 60 ? `${Math.floor(left / 60)}시간 ${left % 60}분` : `${left}분`}`;
  if (left === 0) label = '진화 조건을 채우면 진화해요 · 상태에서 확인';
  return { percent, left, label };
}

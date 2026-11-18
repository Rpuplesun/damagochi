import { advance } from './game.js';

export const PUSH_DEFAULTS = Object.freeze({ enabled: false, quietStart: 23, quietEnd: 7,
  categories: Object.freeze({ hunger: true, strength: true, clean: true, sick: true, lights: true, evolve: true }) });
const MINUTE = 60_000;
const LABELS = {
  hunger: { action: 'feed', title: '밥 주러 가기', body: '배고픔 하트가 부족해질 것 같아요. 게임을 열어 상태를 확인하고 밥을 주세요.' },
  strength: { action: 'vitamin', title: '비타민 주러 가기', body: '힘 하트가 부족해질 것 같아요. 게임을 열어 상태를 확인하고 비타민을 주세요.' },
  clean: { action: 'clean', title: '청소하러 가기', body: '똥이 2개 이상 쌓일 것 같아요. 게임을 열어 상태를 확인하고 청소해 주세요.' },
  sick: { action: 'heal', title: '치료하러 가기', body: '몬스터가 아플 수 있어요. 게임을 열어 현재 상태를 확인하고 치료해 주세요.' },
  lights: { action: 'lights', title: '불 끄러 가기', body: '잠든 몬스터에게 불이 켜져 있을 수 있어요. 게임에서 확인하고 불을 꺼 주세요.' },
  evolution: { action: 'open', title: '성장 확인하기', body: '다음 부화·진화 시각이에요. 예측은 돌봄과 대전 결과에 따라 달라질 수 있어요. 게임에서 확인해 주세요.' },
};
export function normalizePushPreferences(prefs = {}) {
  const hour = (value, fallback) => Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback;
  const categories = {};
  for (const key of Object.keys(PUSH_DEFAULTS.categories)) categories[key] = prefs?.categories?.[key] !== false;
  // Accept evolution as an alias while preserving the parent's v1 extras spelling evolve.
  if (prefs?.categories?.evolution === false) categories.evolve = false;
  return { enabled: prefs?.enabled === true, quietStart: hour(prefs?.quietStart, 23), quietEnd: hour(prefs?.quietEnd, 7), categories };
}
export function isPushQuietTime(at, prefs) {
  const { quietStart: start, quietEnd: end } = normalizePushPreferences(prefs);
  if (start === end) return false;
  const hour = new Date(at).getHours();
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}
/** Forecast only. Never mutates the actual game or runs care from a stale notification. */
export function forecastSchedule(state, prefs = state?.extras?.notifications, { now = Date.now(), horizonMinutes = 1440 } = {}) {
  const settings = normalizePushPreferences(prefs);
  if (!settings.enabled || state?.v !== 1 || !state.pet || state.pet.dead || state.settings?.speed !== 1 || state.extras?.restUntil > now ||
      !Number.isFinite(now) || !Number.isFinite(state.clock) || !Number.isFinite(state.lastReal) || !Number.isFinite(horizonMinutes)) return [];
  // Drop large stale snapshots rather than triggering the game's 30-day catchup loop here.
  if (state.lastReal > now + MINUTE || now - state.lastReal > 1440 * MINUTE) return [];
  let clone;
  try { clone = structuredClone(state); } catch { return []; }
  const horizon = Math.max(0, Math.min(1440, Math.floor(horizonMinutes)));
  const end = now + horizon * MINUTE;
  const jobs = [];
  const emitted = new Set();
  const last = {};
  let evolved = false;
  const emit = (category, at) => {
    if (!settings.categories[category === 'evolution' ? 'evolve' : category] || isPushQuietTime(at, settings)) return;
    if (last[category] !== undefined) return; // One first actionable forecast per category per sync.
    const key = `${clone.pet.id}|${category}|${at}`;
    if (emitted.has(key) || jobs.length >= 128) return;
    emitted.add(key);
    last[category] = at;
    const label = LABELS[category];
    jobs.push({ id: key, category, petId: clone.pet.id, dueAt: at, title: '도트몬 돌봄 알림', body: label.body,
      actions: [{ action: label.action, title: label.title }] });
  };
  const care = at => {
    const pet = clone.pet;
    if (pet.dead || pet.species === 'egg') return;
    if (!pet.asleep && pet.hunger <= 1) emit('hunger', at);
    if (!pet.asleep && pet.strength <= 1) emit('strength', at);
    if (pet.poop >= 2) emit('clean', at);
    if (pet.sick) emit('sick', at);
    if (pet.asleep && pet.lightsOn) emit('lights', at);
  };
  // Catch up at most 1440 steps on the clone. Ignore all historical transition events.
  try { advance(clone, now); } catch { return []; }
  if (clone.pet.dead || horizon === 0) return [];
  care(now);
  // Preserve the v1 fractional minute offset (e.g. :17 seconds), not rounded wall-clock minutes.
  let real = clone.lastReal + MINUTE;
  for (let step = 0; step < 1440 && real <= end && !clone.pet.dead; step++, real += MINUTE) {
    let events;
    try { events = advance(clone, real); } catch { return []; }
    if (clone.pet.dead) break;
    if (!evolved && events.some(event => event.type === 'hatch' || event.type === 'evolve')) { emit('evolution', real); evolved = true; }
    care(real);
  }
  return jobs.sort((a, b) => a.dueAt - b.dueAt || a.category.localeCompare(b.category));
}

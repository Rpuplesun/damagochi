// 게임 상태와 시간 흐름. DOM에 의존하지 않는 순수 로직이라 node 테스트로 검증한다.
//
// 시간은 1분 단위 스텝으로 흘러간다. 앱을 꺼 둔 동안의 시간도 다시 켰을 때
// 한 번에 시뮬레이션하므로, 방치하면 그만큼 배고파지고 케어 실수가 쌓인다.

import {
  SAVE_VERSION,
  STAGE_CONFIG,
  STAGE_ORDER,
  MAX_HEARTS,
  POOP_MAX,
  CALL_REPEAT_MIN,
  LIGHTS_GRACE_MIN,
  SICK_CALL_MIN,
  SICK_DEATH_MIN,
  STARVE_DEATH_MIN,
  MAX_CATCHUP_MIN,
  BATTLE_MIN_STAGE,
  BATTLE_INJURY_CHANCE,
  BATTLE_WEIGHT_COST,
  TRAIN_WEIGHT_COST,
  DEFAULT_SETTINGS,
} from './config.js';
import { SPECIES, speciesOf, pickEvolution } from './species.js';
import { randomSeed } from './rng.js';

const MINUTE = 60 * 1000;

export function stageOf(pet) {
  return speciesOf(pet.species).stage;
}

export function stageCfg(speciesId) {
  const sp = speciesOf(speciesId);
  return { ...STAGE_CONFIG[sp.stage], ...(sp.cfg || {}) };
}

export function stageIndex(stage) {
  return STAGE_ORDER.indexOf(stage);
}

function makeId() {
  return randomSeed().toString(36) + Date.now().toString(36).slice(-4);
}

export function createPet(now) {
  return {
    id: makeId(),
    name: '',
    species: 'egg',
    path: ['egg'],
    bornAt: now,
    ageMin: 0,
    stageMin: 0,
    hunger: 0,
    strength: 0,
    weight: 5,
    hungerTimer: 0,
    strengthTimer: 0,
    poopTimer: 0,
    hungerZeroMin: 0,
    strengthZeroMin: 0,
    poop: 0,
    sick: false,
    sickMin: 0,
    asleep: false,
    lightsOn: true,
    sleepMin: 0,
    lightsPenalized: false,
    mistakes: 0,
    stageMistakes: 0,
    trainTotal: 0,
    stageTrain: 0,
    overfeed: 0,
    battles: 0,
    wins: 0,
    stageBattles: 0,
    stageWins: 0,
    dead: false,
    deathCause: null,
    diedAt: null,
  };
}

export function createState(now) {
  return {
    v: SAVE_VERSION,
    clock: now, // 게임 내부 시각 (배속 1이면 실제 시각과 같다)
    lastReal: now, // 마지막으로 시간을 반영한 실제 시각
    settings: { ...DEFAULT_SETTINGS },
    pet: createPet(now),
    dex: { egg: now },
    graveyard: [],
  };
}

export function isSleepTime(clockMs, settings) {
  const { sleepHour, wakeHour } = settings;
  if (sleepHour === wakeHour) return false;
  const h = new Date(clockMs).getHours();
  if (sleepHour > wakeHour) return h >= sleepHour || h < wakeHour;
  return h >= sleepHour && h < wakeHour;
}

/** 지금 몬스터가 주인을 부르고 있는지 (화면에 ! 표시). */
export function callReasons(pet) {
  if (!pet || pet.dead || pet.species === 'egg') return [];
  const r = [];
  if (pet.asleep) {
    if (pet.lightsOn) r.push('lights');
    if (pet.sick) r.push('sick');
    return r;
  }
  if (pet.hunger === 0) r.push('hunger');
  if (pet.strength === 0) r.push('strength');
  if (pet.sick) r.push('sick');
  return r;
}

function addMistake(pet, reason, events, at) {
  pet.mistakes += 1;
  pet.stageMistakes += 1;
  events.push({ type: 'mistake', reason, at });
}

function die(state, cause, events) {
  const pet = state.pet;
  if (pet.dead) return;
  pet.dead = true;
  pet.deathCause = cause;
  pet.diedAt = state.clock;
  pet.asleep = false;
  events.push({ type: 'death', cause, at: state.clock });
}

function recordDex(state, speciesId) {
  if (!state.dex[speciesId]) state.dex[speciesId] = state.clock;
}

function evolveTo(state, to, events) {
  const pet = state.pet;
  const from = pet.species;
  pet.species = to;
  pet.path.push(to);
  pet.stageMin = 0;
  pet.stageMistakes = 0;
  pet.stageTrain = 0;
  pet.overfeed = 0;
  pet.stageBattles = 0;
  pet.stageWins = 0;
  pet.hungerTimer = 0;
  pet.strengthTimer = 0;
  pet.poopTimer = 0;
  const cfg = stageCfg(to);
  if (cfg.minWeight && pet.weight < cfg.minWeight) pet.weight = cfg.minWeight;
  recordDex(state, to);
  events.push({ type: from === 'egg' ? 'hatch' : 'evolve', from, to, at: state.clock });
}

export function evolutionContext(pet) {
  return {
    mistakes: pet.stageMistakes,
    train: pet.stageTrain,
    overfeed: pet.overfeed,
    battles: pet.stageBattles,
    wins: pet.stageWins,
  };
}

function tryEvolve(state, events) {
  const pet = state.pet;
  const cfg = stageCfg(pet.species);
  if (pet.stageMin < cfg.duration) return;
  const to = pickEvolution(pet.species, evolutionContext(pet));
  if (to) evolveTo(state, to, events);
}

/** 1분을 진행한다. state.clock은 이미 이번 분의 끝으로 옮겨진 상태다. */
export function stepMinute(state, events) {
  const pet = state.pet;
  if (!pet || pet.dead) return;
  const now = state.clock;

  if (pet.species === 'egg') {
    pet.stageMin += 1;
    tryEvolve(state, events);
    return;
  }

  pet.ageMin += 1;
  pet.stageMin += 1;
  const cfg = stageCfg(pet.species);

  // 수면
  const sleepTime = isSleepTime(now, state.settings);
  if (sleepTime && !pet.asleep) {
    pet.asleep = true;
    pet.sleepMin = 0;
    pet.lightsPenalized = false;
    events.push({ type: 'sleep', at: now });
  } else if (!sleepTime && pet.asleep) {
    pet.asleep = false;
    pet.lightsOn = true;
    events.push({ type: 'wake', at: now });
  }

  if (pet.asleep) {
    pet.sleepMin += 1;
    if (pet.lightsOn && !pet.lightsPenalized && pet.sleepMin >= LIGHTS_GRACE_MIN) {
      pet.lightsPenalized = true;
      addMistake(pet, 'lights', events, now);
    }
  } else {
    // 배고픔 / 힘 감소
    pet.hungerTimer += 1;
    if (pet.hungerTimer >= cfg.hungerEvery) {
      pet.hungerTimer = 0;
      if (pet.hunger > 0) pet.hunger -= 1;
    }
    pet.strengthTimer += 1;
    if (pet.strengthTimer >= cfg.strengthEvery) {
      pet.strengthTimer = 0;
      if (pet.strength > 0) pet.strength -= 1;
    }

    // 똥
    pet.poopTimer += 1;
    if (pet.poopTimer >= cfg.poopEvery) {
      pet.poopTimer = 0;
      if (pet.poop < POOP_MAX) {
        pet.poop += 1;
        events.push({ type: 'poop', at: now });
      }
      if (pet.poop >= POOP_MAX && !pet.sick) {
        pet.sick = true;
        pet.sickMin = 0;
        events.push({ type: 'sick', reason: 'poop', at: now });
      }
    }

    // 호출 방치 → 케어 실수
    if (pet.hunger === 0) {
      pet.hungerZeroMin += 1;
      if (isCallMistakeMinute(pet.hungerZeroMin, cfg.callTimeout)) addMistake(pet, 'hunger', events, now);
      if (pet.hungerZeroMin >= STARVE_DEATH_MIN) {
        die(state, 'starve', events);
        return;
      }
    } else {
      pet.hungerZeroMin = 0;
    }
    if (pet.strength === 0) {
      pet.strengthZeroMin += 1;
      if (isCallMistakeMinute(pet.strengthZeroMin, cfg.callTimeout)) addMistake(pet, 'strength', events, now);
    } else {
      pet.strengthZeroMin = 0;
    }
  }

  // 병
  if (pet.sick) {
    pet.sickMin += 1;
    if (pet.sickMin === SICK_CALL_MIN) addMistake(pet, 'sick', events, now);
    if (pet.sickMin >= SICK_DEATH_MIN) {
      die(state, 'sick', events);
      return;
    }
  }

  tryEvolve(state, events);
}

function isCallMistakeMinute(zeroMin, timeout) {
  if (zeroMin < timeout) return false;
  return (zeroMin - timeout) % CALL_REPEAT_MIN === 0;
}

/**
 * 실제 시각 realNow까지 게임 시간을 진행한다. 진행 중 생긴 이벤트 목록을 돌려준다.
 * 배속(settings.speed)이 1보다 크면 게임 시계가 실제보다 빨리 간다 (테스트용).
 */
export function advance(state, realNow) {
  const events = [];
  const speed = Math.max(1, state.settings.speed || 1);
  if (realNow < state.lastReal) {
    // 기기 시계가 뒤로 갔다. 시간을 되감지 않고 기준점만 맞춘다.
    state.lastReal = realNow;
    return events;
  }
  let target = state.clock + (realNow - state.lastReal) * speed;
  const cap = state.clock + MAX_CATCHUP_MIN * MINUTE;
  if (target > cap) target = cap;
  while (state.clock + MINUTE <= target) {
    state.clock += MINUTE;
    stepMinute(state, events);
  }
  const remainder = Math.max(0, target - state.clock);
  state.lastReal = realNow - remainder / speed;
  return events;
}

// ───────────────────────── 플레이어 행동 ─────────────────────────

const fail = (reason) => ({ ok: false, reason });

function checkAwake(pet) {
  if (!pet || pet.dead) return fail('dead');
  if (pet.species === 'egg') return fail('egg');
  if (pet.asleep) return fail('asleep');
  return null;
}

export function feedMeat(state) {
  const pet = state.pet;
  const bad = checkAwake(pet);
  if (bad) return bad;
  const full = pet.hunger >= MAX_HEARTS;
  if (full) pet.overfeed += 1;
  else pet.hunger += 1;
  pet.weight += 1;
  pet.hungerZeroMin = 0;
  return { ok: true, full };
}

export function feedVitamin(state) {
  const pet = state.pet;
  const bad = checkAwake(pet);
  if (bad) return bad;
  const full = pet.strength >= MAX_HEARTS;
  if (!full) pet.strength += 1;
  pet.weight += 2;
  pet.strengthZeroMin = 0;
  return { ok: true, full };
}

export function canTrain(state) {
  const pet = state.pet;
  const bad = checkAwake(pet);
  if (bad) return bad;
  if (pet.sick) return fail('sick');
  return { ok: true };
}

export function applyTraining(state, success) {
  const ok = canTrain(state);
  if (!ok.ok) return ok;
  const pet = state.pet;
  const cfg = stageCfg(pet.species);
  pet.weight = Math.max(cfg.minWeight || 1, pet.weight - TRAIN_WEIGHT_COST);
  if (success) {
    pet.stageTrain += 1;
    pet.trainTotal += 1;
    if (pet.strength < MAX_HEARTS) pet.strength += 1;
    pet.strengthZeroMin = 0;
  }
  return { ok: true, success };
}

export function clean(state) {
  const pet = state.pet;
  if (!pet || pet.dead || pet.species === 'egg') return fail('dead');
  if (pet.poop === 0) return fail('clean');
  pet.poop = 0;
  return { ok: true };
}

export function heal(state) {
  const pet = state.pet;
  if (!pet || pet.dead || pet.species === 'egg') return fail('dead');
  if (!pet.sick) return fail('healthy');
  pet.sick = false;
  pet.sickMin = 0;
  return { ok: true };
}

export function toggleLights(state) {
  const pet = state.pet;
  if (!pet || pet.dead || pet.species === 'egg') return fail('dead');
  if (!pet.asleep) return fail('awake');
  pet.lightsOn = !pet.lightsOn;
  return { ok: true, lightsOn: pet.lightsOn };
}

export function canBattle(state) {
  const pet = state.pet;
  const bad = checkAwake(pet);
  if (bad) return bad;
  if (stageIndex(stageOf(pet)) < stageIndex(BATTLE_MIN_STAGE)) return fail('young');
  if (pet.sick) return fail('sick');
  if (pet.hunger === 0) return fail('hungry');
  return { ok: true };
}

export function applyBattleResult(state, won, rng = Math.random) {
  const pet = state.pet;
  const cfg = stageCfg(pet.species);
  pet.battles += 1;
  pet.stageBattles += 1;
  if (won) {
    pet.wins += 1;
    pet.stageWins += 1;
  }
  if (pet.hunger > 0) pet.hunger -= 1;
  pet.weight = Math.max(cfg.minWeight || 1, pet.weight - BATTLE_WEIGHT_COST);
  let injured = false;
  if (!won && rng() < BATTLE_INJURY_CHANCE) {
    pet.sick = true;
    pet.sickMin = 0;
    injured = true;
  }
  return { ok: true, injured };
}

export function rename(state, name) {
  state.pet.name = String(name || '').trim().slice(0, 8);
}

/** 지금 몬스터를 기록에 남기고 새 알을 받는다. */
export function newEgg(state) {
  const pet = state.pet;
  if (pet && pet.species !== 'egg') {
    state.graveyard.unshift({
      name: pet.name,
      species: pet.species,
      path: pet.path.slice(),
      bornAt: pet.bornAt,
      endedAt: pet.dead ? pet.diedAt : state.clock,
      ageMin: pet.ageMin,
      cause: pet.dead ? pet.deathCause : 'farewell',
      battles: pet.battles,
      wins: pet.wins,
      mistakes: pet.mistakes,
    });
    state.graveyard = state.graveyard.slice(0, 50);
  }
  state.pet = createPet(state.clock);
}

/** 다음 진화까지 남은 시간(분). 완전체거나 대전 조건이 남았으면 null. */
export function minutesToEvolve(pet) {
  const cfg = stageCfg(pet.species);
  if (!Number.isFinite(cfg.duration)) return null;
  return Math.max(0, cfg.duration - pet.stageMin);
}

/** 오프라인 동안 생긴 이벤트를 요약한다. */
export function summarizeEvents(events) {
  const s = { evolutions: [], mistakes: 0, poops: 0, sick: false, death: null };
  for (const e of events) {
    if (e.type === 'evolve' || e.type === 'hatch') s.evolutions.push(e);
    else if (e.type === 'mistake') s.mistakes += 1;
    else if (e.type === 'poop') s.poops += 1;
    else if (e.type === 'sick') s.sick = true;
    else if (e.type === 'death') s.death = e.cause;
  }
  return s;
}

export function isKnownSpecies(id) {
  return Object.prototype.hasOwnProperty.call(SPECIES, id);
}

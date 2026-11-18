// 대전 계산. 서로 번갈아 공격하고 먼저 3번 맞힌 쪽이 이긴다.

import { speciesOf, SPECIES } from './species.js';
import { stageCfg } from './game.js';
import { randInt, pick } from './rng.js';

export const BATTLE_HP = 3;

/** 몬스터의 대전 파워. 종 기본값 + 힘 하트 + 누적 훈련 - 과체중 페널티. */
export function battlePower(pet) {
  const sp = speciesOf(pet.species);
  const cfg = stageCfg(pet.species);
  const base = sp.power || 1;
  const str = pet.strength * 4;
  const train = Math.floor(Math.min(pet.trainTotal, 30) / 3);
  const over = Math.max(0, pet.weight - ((cfg.minWeight || 0) + 20));
  const penalty = Math.min(10, Math.floor(over / 2));
  return Math.max(1, base + str + train - penalty);
}

export function hitChance(attacker, defender) {
  const p = attacker / (attacker + defender);
  return 0.2 + 0.6 * p;
}

/**
 * 대전을 시뮬레이션한다. 결과는 애니메이션 재생에 쓰는 공격 기록(log)과 승자.
 * A = 내 몬스터, B = 상대.
 */
export function simulateBattle(powerA, powerB, rng) {
  let hpA = BATTLE_HP;
  let hpB = BATTLE_HP;
  const log = [];
  let turnA = rng() < 0.5;
  for (let i = 0; i < 40 && hpA > 0 && hpB > 0; i++) {
    if (turnA) {
      const hit = rng() < hitChance(powerA, powerB);
      if (hit) hpB -= 1;
      log.push({ by: 'A', hit, hpA, hpB });
    } else {
      const hit = rng() < hitChance(powerB, powerA);
      if (hit) hpA -= 1;
      log.push({ by: 'B', hit, hpA, hpB });
    }
    turnA = !turnA;
  }
  let winner;
  if (hpB <= 0) winner = 'A';
  else if (hpA <= 0) winner = 'B';
  else winner = powerA >= powerB ? 'A' : 'B';
  return { winner, log };
}

/** 야생(CPU) 상대를 만든다. 같은 단계의 몬스터 중에서 무작위. */
export function makeWildOpponent(pet, rng) {
  const stage = speciesOf(pet.species).stage;
  const pool = Object.keys(SPECIES).filter((id) => SPECIES[id].stage === stage);
  const species = pick(rng, pool);
  const sp = SPECIES[species];
  const power = sp.power + randInt(rng, 0, 3) * 4 + randInt(rng, 0, 6);
  return { species, name: `야생 ${sp.name}`, power };
}

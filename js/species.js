// 몬스터 도감 데이터와 진화 규칙.
// 새 몬스터를 추가하려면: 이미지/도트 데이터를 준비하고, 여기에 항목을 추가한 뒤
// 이전 단계 몬스터의 evolutions 목록에 규칙을 넣으면 된다.
//
// 진화 규칙(cond)에서 쓸 수 있는 키 (모두 "현재 단계에서" 쌓인 값 기준):
//   mistakesMin / mistakesMax : 케어 실수 횟수
//   trainMin / trainMax       : 훈련 성공 횟수
//   overfeedMin               : 과식 횟수
//   battlesMin                : 대전 횟수
//   winRateMin                : 승률 (0~1)
// evolutions는 위에서부터 차례로 검사해서 처음 만족하는 규칙으로 진화한다.

import { DIGIMON_IMAGES } from './digimon-assets.js';

export const SPECIES = {
  egg: {
    name: '알',
    stage: 'egg',
    desc: '무언가 꿈틀거리는 데이터 알.',
    evolutions: [{ to: 'ttol' }],
  },
  ttol: {
    name: '똘',
    stage: 'baby',
    power: 2,
    desc: '막 태어난 도트 생명체. 머리 위 새싹이 자랑이다.',
    hint: '알에서 태어난다.',
    evolutions: [{ to: 'ttolttol' }],
  },
  ttolttol: {
    name: '똘똘',
    stage: 'child',
    power: 5,
    desc: '귀가 쫑긋 자랐다. 호기심이 많아 뭐든 입에 넣어 본다.',
    hint: '똘이 자라면 된다.',
    evolutions: [
      { to: 'piko', cond: { mistakesMax: 1 } },
      { to: 'monggle' },
    ],
  },
  piko: {
    name: '피코',
    stage: 'rookie',
    power: 22,
    desc: '작은 뿔이 난 꼬마 용. 겁이 없고 활발하다.',
    hint: '똘똘을 실수 없이 잘 돌보면…',
    evolutions: [
      { to: 'noise', cond: { mistakesMin: 6 } },
      { to: 'volt', cond: { trainMin: 8, mistakesMax: 2 } },
      { to: 'mungchi', cond: { overfeedMin: 4 } },
      { to: 'kara' },
    ],
  },
  monggle: {
    name: '몽글',
    stage: 'rookie',
    power: 18,
    desc: '몽글몽글한 젤리 몸. 서툴게 자랐어도 씩씩하다.',
    hint: '똘똘을 조금 서툴게 돌보면…',
    evolutions: [
      { to: 'noise', cond: { mistakesMin: 6 } },
      { to: 'jellion', cond: { trainMin: 8 } },
      { to: 'mungchi', cond: { overfeedMin: 4 } },
      { to: 'mush' },
    ],
  },
  volt: {
    name: '볼트',
    stage: 'champion',
    power: 48,
    desc: '번개 꼬리를 가진 늑대. 성실하게 훈련한 아이만 될 수 있다.',
    hint: '피코를 꼼꼼히 돌보며 열심히 훈련시키면…',
    evolutions: [{ to: 'raiga', cond: { battlesMin: 8, winRateMin: 0.6 } }],
  },
  kara: {
    name: '카라',
    stage: 'champion',
    power: 42,
    desc: '바람을 타는 새. 자유분방해서 훈련은 질색이다.',
    hint: '피코를 평범하게 키우면…',
    evolutions: [{ to: 'raiga', cond: { battlesMin: 8, winRateMin: 0.6 } }],
  },
  mungchi: {
    name: '뭉치',
    stage: 'champion',
    power: 40,
    desc: '동글동글한 곰. 세상에서 먹는 게 제일 좋다.',
    hint: '배가 불러도 자꾸 밥을 주면…',
    evolutions: [{ to: 'grove', cond: { battlesMin: 8, winRateMin: 0.6 } }],
  },
  jellion: {
    name: '젤리온',
    stage: 'champion',
    power: 46,
    desc: '단단한 투구를 쓴 젤리 기사. 말랑하지만 단단하다.',
    hint: '몽글을 열심히 훈련시키면…',
    evolutions: [{ to: 'grove', cond: { battlesMin: 8, winRateMin: 0.6 } }],
  },
  mush: {
    name: '머쉬',
    stage: 'champion',
    power: 38,
    desc: '포자를 날리는 버섯. 느긋함의 달인.',
    hint: '몽글을 평범하게 키우면…',
    evolutions: [{ to: 'grove', cond: { battlesMin: 8, winRateMin: 0.6 } }],
  },
  noise: {
    name: '노이즈',
    stage: 'champion',
    power: 35,
    desc: '돌봄을 받지 못해 데이터가 깨져 버린 존재. 지지직…',
    hint: '성장기를 너무 방치하면…',
    evolutions: [{ to: 'buglord', cond: { battlesMin: 8, winRateMin: 0.6 } }],
  },
  raiga: {
    name: '라이가',
    stage: 'ultimate',
    power: 75,
    desc: '하늘을 가르는 천둥 용. 수많은 대전을 이겨낸 증표.',
    hint: '하늘의 성숙기가 대전에서 승리를 거듭하면…',
    evolutions: [],
  },
  grove: {
    name: '그로브',
    stage: 'ultimate',
    power: 72,
    desc: '숲을 등에 진 거인. 걸음마다 새싹이 돋는다.',
    hint: '땅의 성숙기가 대전에서 승리를 거듭하면…',
    evolutions: [],
  },
  buglord: {
    name: '버그로드',
    stage: 'ultimate',
    power: 70,
    desc: '깨진 데이터에서 피어난 버그의 군주.',
    hint: '깨진 존재가 대전에서 승리를 거듭하면…',
    evolutions: [],
  },
};

// 이미지 교체만 적용한다. 기존 종 ID/이름/진화/능력치와 세이브는 유지한다.
for (const [id, visual] of Object.entries(DIGIMON_IMAGES)) {
  Object.assign(SPECIES[id], visual);
}

export const SPECIES_ORDER = Object.keys(SPECIES);

export function speciesOf(id) {
  const sp = SPECIES[id];
  if (!sp) throw new Error(`unknown species: ${id}`);
  return sp;
}

/** 진화 조건 하나를 검사한다. */
export function matchesCond(cond, ctx) {
  if (!cond) return true;
  const winRate = ctx.battles > 0 ? ctx.wins / ctx.battles : 0;
  if (cond.mistakesMin != null && ctx.mistakes < cond.mistakesMin) return false;
  if (cond.mistakesMax != null && ctx.mistakes > cond.mistakesMax) return false;
  if (cond.trainMin != null && ctx.train < cond.trainMin) return false;
  if (cond.trainMax != null && ctx.train > cond.trainMax) return false;
  if (cond.overfeedMin != null && ctx.overfeed < cond.overfeedMin) return false;
  if (cond.battlesMin != null && ctx.battles < cond.battlesMin) return false;
  if (cond.winRateMin != null && winRate < cond.winRateMin) return false;
  return true;
}

/** 현재 종과 단계 기록으로 진화할 종을 고른다. 조건을 만족하는 게 없으면 null. */
export function pickEvolution(speciesId, ctx) {
  const sp = speciesOf(speciesId);
  for (const rule of sp.evolutions) {
    if (matchesCond(rule.cond, ctx)) return rule.to;
  }
  return null;
}

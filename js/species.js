// 디지몬 도감과 진화 규칙. 원본 데이터는 js/digimon-data.js(자동 생성)에 있다.
// 디지몬을 추가·수정하려면 scripts/import-digimon.py 와 scripts/digimon-ko.json 을 고친다.
//
// 진화는 "트리" 단위로 정해진다. 같은 디지몬도 어느 알(트리)에서 태어났는지에 따라
// 다음 진화가 달라진다. 진화 규칙(cond) 키는 모두 "현재 단계에서" 쌓인 값 기준이다:
//   mistakesMin / mistakesMax : 케어 실수 횟수
//   trainMin / trainMax       : 훈련 성공 횟수
//   overfeedMin               : 과식 횟수
//   battlesMin                : 대전 횟수
//   winRateMin                : 승률 (0~1)
//   dexHas                    : 조그레스 — 도감에 등록된 파트너 디지몬
// 규칙은 위에서부터 차례로 검사해서 처음 만족하는 쪽으로 진화한다.

import { ATLAS, DIGIMON, EGGS, TREES as TREE_DATA } from './digimon-data.js';

const STAGE_TEXT = {
  baby: '갓 태어난 유년기 디지몬. 아직 작고 말랑하다.',
  child: '조금 자란 유년기 디지몬. 호기심이 많다.',
  rookie: '스스로 싸울 수 있게 된 성장기 디지몬.',
  champion: '몸집과 힘이 크게 자란 성숙기 디지몬.',
  ultimate: '수많은 싸움을 이겨낸 완전체 디지몬.',
  mega: '진화의 정점에 오른 궁극체 디지몬.',
  super: '궁극을 넘어선 초궁극체. 전설로만 전해진다.',
};

/** 구버전(v1 초기) 세이브의 종 ID → 현재 디지몬 키. */
export const LEGACY_SPECIES = {
  ttol: 'bota', ttolttol: 'koro', piko: 'agu', monggle: 'jelly', volt: 'garuru',
  kara: 'birdra', mungchi: 'gryz', jellion: 'shell', mush: 'vegi', noise: 'bake',
  raiga: 'metalgrey_va', grove: 'petaldra', buglord: 'vamde',
};
export const DEFAULT_TREE = 'agu_ex';

const toRule = ([to, cond]) => (cond ? { to, cond } : { to });

export const TREES = {};
for (const [id, tree] of Object.entries(TREE_DATA)) {
  const rules = { egg: [{ to: tree.root }] };
  for (const [from, list] of Object.entries(tree.rules)) rules[from] = list.map(toRule);
  TREES[id] = { id, name: tree.ko, enName: tree.en, egg: tree.egg, root: tree.root, members: tree.members, rules };
}
export const TREE_ORDER = Object.keys(TREES);

export const SPECIES = {
  egg: {
    name: '디지타마',
    digimonName: '디지타마',
    stage: 'egg',
    desc: '무언가 꿈틀거리는 디지타마. 어떤 디지몬이 태어날까?',
    evolutions: [...new Set(TREE_ORDER.map((id) => TREES[id].root))].map((to) => ({ to })),
    trees: TREE_ORDER.slice(),
  },
};
for (const [id, mon] of Object.entries(DIGIMON)) {
  SPECIES[id] = {
    name: mon.ko,
    digimonName: mon.ko,
    enName: mon.en,
    stage: mon.stage,
    power: mon.power,
    desc: STAGE_TEXT[mon.stage],
    evolutions: [],
    trees: [],
  };
}
// 도감용: 모든 트리의 진화를 합친 목록 (같은 진화는 한 번만).
for (const tree of Object.values(TREES)) {
  for (const id of tree.members) SPECIES[id].trees.push(tree.id);
  for (const [from, rules] of Object.entries(tree.rules)) {
    if (from === 'egg') continue;
    for (const rule of rules) {
      if (!SPECIES[from].evolutions.some((known) => known.to === rule.to)) SPECIES[from].evolutions.push(rule);
    }
  }
}

export const SPECIES_ORDER = Object.keys(SPECIES);

export function speciesOf(id) {
  const sp = SPECIES[id];
  if (!sp) throw new Error(`unknown species: ${id}`);
  return sp;
}

export function isKnownTree(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TREES, id);
}

/** 구버전 ID를 현재 키로 바꾼다. 모르는 ID는 그대로 돌려준다. */
export function canonicalSpecies(id) {
  return Object.prototype.hasOwnProperty.call(LEGACY_SPECIES, id) ? LEGACY_SPECIES[id] : id;
}

/** 트리 정보가 없는 구버전 몬스터가 속할 트리를 고른다. */
export function inferTree(speciesId) {
  if (TREES[DEFAULT_TREE].members.includes(speciesId)) return DEFAULT_TREE;
  return SPECIES[speciesId]?.trees?.[0] || DEFAULT_TREE;
}

/** 이 몬스터에게 적용되는 진화 규칙 목록. */
export function evolutionRules(speciesId, treeId) {
  // 트리에 속한 종은 그 트리의 규칙만 따른다 (규칙이 없으면 그 트리의 최종 단계).
  if (isKnownTree(treeId) && (speciesId === 'egg' || TREES[treeId].members.includes(speciesId))) {
    return TREES[treeId].rules[speciesId] || [];
  }
  return speciesOf(speciesId).evolutions;
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
  if (cond.dexHas != null && !(ctx.dex && ctx.dex[cond.dexHas])) return false;
  return true;
}

/** 현재 종과 단계 기록으로 진화할 종을 고른다. 조건을 만족하는 게 없으면 null. */
export function pickEvolution(speciesId, ctx) {
  for (const rule of evolutionRules(speciesId, ctx.tree)) {
    if (matchesCond(rule.cond, ctx)) return rule.to;
  }
  return null;
}

/** 진화 조건을 사람이 읽는 문장 조각으로 바꾼다. */
export function condText(cond) {
  if (!cond) return '조건 없음 (다른 조건을 못 채우면 이쪽)';
  const parts = [];
  if (cond.trainMin != null) parts.push(`훈련 성공 ${cond.trainMin}회 이상`);
  if (cond.trainMax != null) parts.push(`훈련 성공 ${cond.trainMax}회 이하`);
  if (cond.battlesMin != null) parts.push(`대전 ${cond.battlesMin}회 이상`);
  if (cond.winRateMin != null) parts.push(`승률 ${Math.round(cond.winRateMin * 100)}% 이상`);
  if (cond.mistakesMax != null) parts.push(`케어 실수 ${cond.mistakesMax}회 이하`);
  if (cond.mistakesMin != null) parts.push(`케어 실수 ${cond.mistakesMin}회 이상`);
  if (cond.overfeedMin != null) parts.push(`과식 ${cond.overfeedMin}회 이상`);
  if (cond.dexHas != null) parts.push(`조그레스: 도감에 ${SPECIES[cond.dexHas]?.name || cond.dexHas} 등록`);
  return parts.join(' · ');
}

// 도감 힌트: 어떤 디지몬에서 어떤 조건으로 진화하는지 (한 번만 계산한다).
const HINTS = {};
for (const tree of Object.values(TREES)) {
  for (const [from, rules] of Object.entries(tree.rules)) {
    for (const rule of rules) {
      const text = from === 'egg' ? `${tree.name} 디지타마에서 태어난다`
        : `${SPECIES[from].name}에서 ${rule.cond ? condText(rule.cond) : '시간이 지나면'}`;
      const list = HINTS[rule.to] || (HINTS[rule.to] = []);
      if (!list.includes(text)) list.push(text);
    }
  }
}
export function evolutionHints(id) {
  return HINTS[id] ? HINTS[id].slice() : [];
}
for (const id of Object.keys(DIGIMON)) {
  const hints = HINTS[id] || [];
  SPECIES[id].hint = hints.length ? `${hints[0]}${hints.length > 1 ? ` 외 ${hints.length - 1}가지` : ''}` : '';
}

// ───────────────────────── 그림 ─────────────────────────

/** 알은 트리마다 무늬가 다르다. 그림 전용 ID(egg:<무늬>)를 돌려준다. */
export function eggVisualId(treeId) {
  const tree = TREES[isKnownTree(treeId) ? treeId : DEFAULT_TREE];
  return `egg:${tree.egg}`;
}

/** 화면에 그릴 때 쓰는 ID. 알만 트리별 그림으로 바뀐다. */
export function visualId(pet) {
  return pet.species === 'egg' ? eggVisualId(pet.tree) : pet.species;
}

/**
 * 그림 ID의 스프라이트 시트 정보.
 * { cells: [포즈별 셀 번호], box: [l, t, r, b] (셀 안의 실제 그림 영역), bits: 16×16 폴백 }
 */
export function spriteInfo(id) {
  if (typeof id !== 'string') return null;
  if (id === 'egg' || id.startsWith('egg:')) {
    const egg = EGGS[id === 'egg' ? TREES[DEFAULT_TREE].egg : id.slice(4)];
    return egg ? { cells: [egg.cell], box: egg.box, bits: egg.bits } : null;
  }
  const mon = Object.prototype.hasOwnProperty.call(DIGIMON, id) ? DIGIMON[id] : null;
  return mon ? { cells: [mon.cell, mon.cell + 1], box: mon.box, bits: mon.bits } : null;
}

export { ATLAS };

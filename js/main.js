// Browser controller for the v1 core. Game rules remain in game.js.

import { STAGE_LABEL, MAX_HEARTS, TRAIN_PASS, TRAIN_ROUNDS, GAME_TITLE } from './config.js';
import {
  advance, callReasons, feedMeat, feedVitamin, canTrain, applyTraining, clean, heal,
  toggleLights, canBattle, applyBattleResult, rename, newEgg, minutesToEvolve,
  summarizeEvents, stageOf,
} from './game.js';
import { SPECIES, SPECIES_ORDER, speciesOf } from './species.js';
import { battlePower, simulateBattle, makeWildOpponent } from './battle.js';
import { encodeFriendCode, decodeFriendCode, encodeSave, decodeSave } from './share.js';
import * as storage from './storage.js';
import { LCD, drawThumb } from './lcd.js';
import { IdleScene, EatScene, CleanScene, EvolveScene, TrainScene, BattleScene, IconScene, PlayScene } from './scenes.js';
import { play, vibrate, unlockAudio, setSoundEnabled } from './sound.js';
import { ensureExtras, logCare, playWithPet, moodOf, growthInfo, TASKS, THEMES, CATEGORIES } from './care.js';
import { inspectPushStatus, enablePush, syncPush, disablePush, testPush } from './push-client.js';
import { isPushQuietTime } from './push-schedule.js';
import { createPushController } from './push-controller.js';

const $ = (selector) => document.querySelector(selector);
const { loadState, saveState, clearState, migrate } = storage;
let state = loadState();
ensureExtras(state);
setSoundEnabled(state.settings.sound);

const canvas = $('#lcd');
const lcd = new LCD(canvas);
const sheet = $('#sheet');
const idle = new IdleScene(() => state);
let scene = idle;
const sceneQueue = [];
let interaction = null;
let lastFrame = performance.now();
let wasCalling = false;
let awayClock = null;
let awayEvents = [];
let interruptedAway = false;
let toastTimer = 0;
let initialLoadWarning = '';

const CALL_TEXT = { hunger: '배고파요', strength: '힘이 없어요', sick: '아파요', lights: '불을 꺼 주세요' };
const DEATH_TEXT = { starve: '굶주림', sick: '병', farewell: '작별' };
const REASON = {
  dead: '키우는 몬스터가 없어요',
  none: '키우는 몬스터가 없어요',
  egg: '아직 알이에요',
  asleep: '쿨쿨 자고 있어요',
  sick: '아파서 못 해요. 먼저 치료해 주세요',
  young: '성장기부터 대전할 수 있어요',
  hungry: '배가 고파서 싸울 수 없어요',
  clean: '치울 똥이 없어요',
  healthy: '아프지 않아요',
  awake: '아직 깨어 있어요. 잘 때 불을 꺼 주세요',
};

// Accessibility feedback is outside the canvas, so it remains available while busy.
for (const selector of ['#scene-hint', '#save-status', '#toast', '#sheet-status', '#call']) {
  const element = $(selector);
  if (!element) continue;
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'true');
}
canvas.setAttribute('tabindex', '0');
canvas.setAttribute('role', 'button');
canvas.setAttribute('aria-label', '몬스터 화면 탭');
if ($('#scene-hint')) canvas.setAttribute('aria-describedby', 'scene-hint');

function text(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function storageWarning(status) {
  if (!status) return '';
  if (status.reason === 'recovered') return '이전 백업에서 복구됨 · 백업을 확인해 주세요';
  if (status.reason === 'corrupt') return '저장 데이터 손상 · 백업 필요';
  if (status.reason === 'unavailable') return '저장 기능을 사용할 수 없어요 · 백업 필요';
  if (status.reason === 'read-failed') return '저장 데이터를 읽지 못했어요 · 백업 필요';
  return '';
}

function persist() {
  ensureExtras(state);
  const saved = saveState(state) === true;
  const warning = storageWarning(storage.getStorageStatus?.());
  text($('#save-status'), saved
    ? initialLoadWarning || '저장됨'
    : warning ? `${warning} · 저장 실패` : '저장 실패 · 백업 필요');
  return saved;
}

function toast(message) {
  const element = sheet.open && $('#sheet-status') ? $('#sheet-status') : $('#toast');
  text(element, message);
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 3000);
}

function fail(result) {
  play('no');
  toast(REASON[result.reason] || '할 수 없어요');
}

function petName(pet) {
  return pet.name || speciesOf(pet.species).name;
}

function speciesLabel(id) {
  const species = speciesOf(id);
  return species.digimonName && species.digimonName !== species.name
    ? `${species.name} · ${species.digimonName}` : species.name;
}

// Plain monochrome glyphs rather than emoji, including on small HUD displays.
function hearts(value) {
  const count = Math.max(0, Math.min(MAX_HEARTS, Math.trunc(value)));
  return '■'.repeat(count) + '□'.repeat(MAX_HEARTS - count);
}

function callText(pet) {
  return callReasons(pet).map((reason) => CALL_TEXT[reason]).join(' · ');
}

function busy() {
  return scene !== idle;
}

function resetScenes() {
  scene.cancel?.();
  for (const queued of sceneQueue) queued.cancel?.();
  sceneQueue.length = 0;
  interaction = null;
  scene = idle;
  updateSceneUi();
}

function pushScene(next) {
  if (!busy()) scene = next;
  else {
    // Only engine events can queue a scene. Care buttons never queue actions.
    for (const queued of sceneQueue) queued.cancel?.();
    sceneQueue.splice(0, sceneQueue.length, next);
  }
  updateSceneUi();
}

function snapshotPet() {
  return {
    state, pet: state.pet, id: state.pet?.id,
    species: state.pet?.species, pathLength: state.pet?.path.length,
  };
}

function samePet(token) {
  const pet = state.pet;
  return token.state === state && token.pet === pet && pet && !pet.dead &&
    token.id === pet.id && token.species === pet.species && token.pathLength === pet.path.length;
}

function sceneHint() {
  if (state.extras.restUntil > Date.now()) return `휴식 모드 · ${Math.ceil((state.extras.restUntil - Date.now()) / 60000)}분 뒤 돌아와요`;
  if (scene instanceof TrainScene) {
    if (scene.phase === 'result') {
      return `훈련 결과 · ${TRAIN_ROUNDS}회 중 ${scene.hits}회 명중 · ${scene.hits >= TRAIN_PASS ? '성공' : '실패'}`;
    }
    const round = Math.min(TRAIN_ROUNDS, scene.round + 1);
    const tip = scene.phase === 'aim'
      ? '게이지 6칸 이상일 때 화면, 탭 버튼 또는 Space/Enter를 누르세요'
      : scene.lastHit ? '명중! 다음 차례를 기다리세요' : '빗나갔어요. 다음 차례를 기다리세요';
    return `훈련 ${round}/${TRAIN_ROUNDS}회 · 명중 ${scene.hits}회 · ${tip}`;
  }
  if (scene instanceof BattleScene) {
    if (scene.i >= scene.log.length) return `대전 결과 · ${scene.won ? '승리' : '패배'} · 화면을 탭해 마무리하세요`;
    return `대전 중 · ${scene.i < 0 ? '상대 등장' : `${scene.i + 1}/${scene.log.length}번째 공격`} · 결과를 기다리세요`;
  }
  if (scene instanceof EvolveScene) {
    const phase = { charge: '에너지 충전', scan: '디지털 데이터 스캔', morph: '새로운 실루엣으로 변환', reveal: '새로운 디지몬 등장', celebrate: '진화 완료 · 화면을 탭해 마무리' }[scene.phase];
    return `${scene.hatch ? '부화' : '디지털 진화'} · ${phase || '데이터를 연결하고 있어요'}`;
  }
  if (scene instanceof PlayScene) return '함께 놀고 있어요. 작은 관심이 친밀도를 높여요';
  if (scene instanceof EatScene) return '먹는 중이에요. 화면을 탭하면 마무리해요';
  if (scene instanceof CleanScene) return '청소 중이에요';
  if (scene instanceof IconScene) return '치료했어요. 잠시 쉬고 있어요';
  const pet = state.pet;
  if (!pet || pet.dead) return '새 알을 받아 다시 시작할 수 있어요';
  if (stageOf(pet) === 'egg') return '알을 돌보고 있어요. 게임 시간 1분 뒤 부화해요';
  if (pet.asleep) return pet.lightsOn ? '잘 시간이에요. 불을 꺼 주세요' : '불을 끄고 편히 자고 있어요';
  if (pet.sick) return '아파요. 치료하고 쌓인 똥도 치워 주세요';
  if (callReasons(pet).length) return `${callText(pet)} · 돌보기 버튼을 눌러 주세요`;
  if (pet.poop) return '똥이 쌓였어요. 청소해 주세요';
  return '밥과 비타민으로 돌봐 주세요. 훈련은 5회 중 3회 명중하면 성공해요';
}

function updateSceneUi() {
  const hint = sceneHint();
  text($('#scene-hint'), hint);
  canvas.setAttribute('aria-busy', String(busy()));
  for (const button of document.querySelectorAll('#actions button')) {
    button.disabled = (busy() || state.extras.restUntil > Date.now()) && !['status', 'more'].includes(button.dataset.act);
  }
  for (const button of document.querySelectorAll('[data-extra="play"], [data-extra="care"]')) button.disabled = busy() || state.extras.restUntil > Date.now();
  const tapButton = $('#btn-tap');
  if (tapButton) {
    tapButton.hidden = !(scene instanceof TrainScene);
    tapButton.disabled = sheet.open || !(scene instanceof TrainScene) || scene.phase === 'shot';
    tapButton.setAttribute('aria-label', '훈련 화면 탭');
    if ($('#scene-hint')) tapButton.setAttribute('aria-describedby', 'scene-hint');
  }
}

function updateHud() {
  const pet = state.pet;
  const extras = ensureExtras(state);
  document.body.dataset.theme = extras.theme;
  const date = new Date(state.clock);
  text($('#clock'), `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}${state.settings.speed > 1 ? ` ×${state.settings.speed}` : ''}`);
  $('#btn-egg').hidden = Boolean(pet && !pet.dead);
  text($('#hud-name'), !pet ? '키우는 몬스터가 없어요' : pet.dead ? `${petName(pet)}의 무덤` : petName(pet));
  const labels = pet ? [STAGE_LABEL[stageOf(pet)], pet.name ? speciesOf(pet.species).name : null, speciesOf(pet.species).digimonName] : [];
  text($('#hud-stage'), labels.filter(Boolean).join(' · '));
  const showHearts = pet && !pet.dead && stageOf(pet) !== 'egg';
  text($('#hud-hunger'), showHearts ? hearts(pet.hunger) : '-');
  text($('#hud-strength'), showHearts ? hearts(pet.strength) : '-');
  text($('#hud-mood'), moodOf(pet, extras));
  text($('#hud-bond'), `${extras.bond}/100`);
  const growth = growthInfo(pet);
  text($('#growth-label'), growth.label);
  if ($('#growth-progress')) $('#growth-progress').value = growth.percent;
  const complete = TASKS.filter(task => extras.daily.counts[task.id] >= task.goal).length;
  text($('#daily-summary'), `오늘의 돌봄 ${complete}/${TASKS.length}`);
  const urgent = pet && !pet.dead && pet.species !== 'egg' ? pet.sick ? '치료가 필요해요' : pet.poop >= 2 ? '청소할 시간이에요' : pet.asleep && pet.lightsOn ? '불을 꺼 주세요' : pet.hunger <= 1 ? '식사할 시간이에요' : pet.strength <= 1 ? '비타민으로 힘을 채워요' : '지금은 편안해요' : '새로운 만남을 기다려요';
  text($('#care-summary'), urgent);
  text($('#rest-status'), extras.restUntil > Date.now() ? `휴식 중 · ${Math.ceil((extras.restUntil - Date.now()) / 60000)}분` : '실제 시간 돌보기');
  const reasons = callReasons(pet);
  $('#call').hidden = !reasons.length;
  text($('#call'), callText(pet));
  for (const button of document.querySelectorAll('#actions button')) {
    const action = button.dataset.act;
    button.classList.toggle('alert',
      (action === 'feed' && reasons.some((reason) => reason === 'hunger' || reason === 'strength')) ||
      (action === 'heal' && reasons.includes('sick')) ||
      (action === 'lights' && reasons.includes('lights')) ||
      (action === 'clean' && Boolean(pet && !pet.dead && pet.poop > 0)));
  }
  updateSceneUi();
}

async function notify(title, body) {
  if (!document.hidden || !('Notification' in globalThis) || Notification.permission !== 'granted') return;
  const preferences = state.extras.notifications;
  if (isPushQuietTime(Date.now(), preferences) || state.extras.restUntil > Date.now() || preferences.enabled) return;
  const category = callReasons(state.pet).find(reason => preferences.categories[reason]);
  if (!category) return;
  const care = { hunger: 'feed', strength: 'vitamin', sick: 'heal', lights: 'lights' }[category];
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) await registration.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'call', renotify: false,
      data: { care, petId: state.pet.id }, actions: [{ action: care, title: '돌보러 가기' }] });
    else new Notification(title, { body });
  } catch { /* Notifications are optional. */ }
}

function checkCall() {
  const calling = callReasons(state.pet).length > 0;
  if (calling && !wasCalling) {
    play('call');
    vibrate([60, 60, 60]);
    void notify('몬스터가 부르고 있어요', callText(state.pet));
  }
  wasCalling = calling;
}

function handleEvents(events, live) {
  if (!live) return;
  const pet = state.pet;
  const death = events.find((event) => event.type === 'death');
  if (death) {
    play('lose');
    toast('몬스터가 세상을 떠났어요. 기록을 남기고 새 알을 받을 수 있어요');
    return;
  }
  // A large time step can contain several evolutions. Show only the final one,
  // and never show a living/evolving sprite over a pet that has since died.
  const evolutions = events.filter((event) => event.type === 'hatch' || event.type === 'evolve');
  const last = evolutions[evolutions.length - 1];
  if (last && pet && !pet.dead && last.to === pet.species) {
    pushScene(new EvolveScene(last.from, last.to, last.type === 'hatch', motionOptions()));
    toast(`${speciesOf(last.to).name}(으)로 ${last.type === 'hatch' ? '태어났어요' : '진화했어요'}`);
  }
}

function advanceClock(live = !document.hidden, realNow = Date.now()) {
  // Keep lastReal untouched while an interactive scene is active. The entire
  // elapsed interval is processed immediately on completion or cancellation.
  if (interaction) return [];
  const extras = ensureExtras(state, realNow);
  if (extras.restUntil) {
    if (realNow < extras.restUntil) {
      state.lastReal = realNow - extras.restRemainder / state.settings.speed;
      updateHud();
      return [];
    }
    state.lastReal = extras.restUntil - extras.restRemainder / state.settings.speed;
    extras.restUntil = 0;
    extras.restRemainder = 0;
    logCare(state, 'resume', '휴식이 끝나 다시 돌보기 시작했어요', realNow);
  }
  const before = snapshotPet();
  const wasDead = state.pet?.dead;
  const events = advance(state, realNow);
  for (const event of events) {
    if (['hatch', 'evolve'].includes(event.type)) logCare(state, event.type, `${speciesLabel(event.from)} → ${speciesLabel(event.to)}`, realNow);
    if (event.type === 'death') logCare(state, 'death', '함께한 시간을 추억으로 남겼어요', realNow);
  }
  if (before.pet !== state.pet || before.species !== state.pet?.species || wasDead !== state.pet?.dead) resetScenes();
  handleEvents(events, live);
  checkCall();
  updateHud();
  return events;
}

function tick() {
  if (interaction && !samePet(interaction)) resetScenes();
  const events = advanceClock(!document.hidden);
  if (document.hidden) awayEvents.push(...events);
  // Hunger, age, stage time and clock change even when no events are emitted.
  persist();
}

function catchUp() {
  resetScenes();
  const before = awayClock ?? state.clock;
  const events = [...awayEvents, ...advanceClock(false)];
  awayClock = null;
  awayEvents = [];
  const minutes = Math.round((state.clock - before) / 60000);
  const summary = summarizeEvents(events);
  if (summary.death || summary.evolutions.length || (minutes >= 30 && (summary.mistakes || summary.sick || summary.poops))) {
    const lines = [`자리를 비운 ${fmtDuration(minutes)} 동안…`];
    for (const event of summary.evolutions) {
      lines.push(`${speciesOf(event.from).name} → ${speciesOf(event.to).name} ${event.type === 'hatch' ? '부화' : '진화'}`);
    }
    if (summary.poops) lines.push(`똥 ${summary.poops}개`);
    if (summary.sick) lines.push('병에 걸렸어요');
    if (summary.mistakes) lines.push(`케어 실수 ${summary.mistakes}회`);
    if (summary.death) lines.push(`몬스터가 세상을 떠났어요 (${DEATH_TEXT[summary.death] || summary.death})`);
    if (interruptedAway) lines.push('진행 중이던 훈련 또는 대전은 취소됐어요. 결과는 기록하지 않았어요.');
    openSheet('그동안의 일', [
      ...lines.map((line) => h('p', {}, line)),
      h('button', { class: 'primary', onclick: closeSheet }, '확인'),
    ]);
  } else if (interruptedAway) {
    toast('화면을 떠나 진행 중이던 훈련 또는 대전을 취소했어요');
  }
  interruptedAway = false;
  handleEvents(events, !document.hidden);
  persist();
  updateHud();
}

function readyForAction() {
  if (state.extras.restUntil > Date.now()) {
    toast('휴식 중이에요. 메뉴에서 휴식을 해제한 뒤 돌봐 주세요');
    return false;
  }
  if (busy()) {
    toast('진행 중인 장면을 먼저 마무리해 주세요');
    return false;
  }
  advanceClock();
  persist();
  if (busy()) {
    toast('부화 또는 진화가 끝난 뒤 다시 눌러 주세요');
    return false;
  }
  return true;
}

function changed() {
  checkCall();
  updateHud();
  void refreshPush(true);
  return persist();
}

function finishInteraction(token, apply) {
  if (interaction !== token) return;
  const valid = samePet(token);
  interaction = null;
  scene = idle;
  sceneQueue.length = 0;
  if (valid) apply();
  else toast('몬스터가 바뀌어 결과를 기록하지 않았어요');
  // Apply the earned result to its original stage, then fairly catch up time.
  advanceClock();
  changed();
}

function train() {
  if (!readyForAction()) return;
  const allowed = canTrain(state);
  if (!allowed.ok) return fail(allowed);
  const token = snapshotPet();
  const training = new TrainScene(state.pet.species, (hits) => {
    finishInteraction(token, () => {
      const result = applyTraining(state, hits >= TRAIN_PASS);
      if (!result.ok) return fail(result);
      if (result.success) logCare(state, 'train', `훈련 ${hits}/${TRAIN_ROUNDS}회 명중`);
      toast(result.success ? `훈련 성공! ${TRAIN_ROUNDS}회 중 ${hits}회 명중` : `훈련 실패 · ${hits}회 명중`);
    });
  });
  token.scene = training;
  interaction = token;
  pushScene(training);
  closeSheet();
  canvas.focus();
}

function feed(kind) {
  if (!readyForAction()) return;
  const result = kind === 'meat' ? feedMeat(state) : feedVitamin(state);
  if (!result.ok) return fail(result);
  if (!result.full) logCare(state, kind === 'meat' ? 'feed' : 'vitamin', kind === 'meat' ? '식사를 챙겨 줬어요' : '비타민으로 힘을 채웠어요');
  play(result.full && kind === 'meat' ? 'no' : 'ok');
  pushScene(new EatScene(state.pet.species, kind, false));
  if (result.full) toast(kind === 'meat' ? '배가 부른데… (과식으로 기록돼요)' : '힘은 이미 가득해요');
  changed();
}

const ACTIONS = {
  status: openStatus,
  more: openMenu,
  feed() {
    if (!readyForAction()) return;
    openSheet('밥 주기', [
      h('div', { class: 'row2' },
        h('button', { class: 'primary', onclick: () => { closeSheet(); feed('meat'); } }, '고기', h('br'), h('small', {}, '배고픔 +1')),
        h('button', { class: 'primary', onclick: () => { closeSheet(); feed('pill'); } }, '비타민', h('br'), h('small', {}, '힘 +1'))),
      h('p', { class: 'muted' }, '배가 부른데 고기를 더 주면 과식으로 기록돼요. 과식은 진화에 영향을 줄 수 있어요.'),
    ]);
  },
  train,
  battle: openBattle,
  clean() {
    if (!readyForAction()) return;
    const result = clean(state);
    if (!result.ok) return fail(result);
    play('ok');
    logCare(state, 'clean', '방을 깨끗이 청소했어요');
    pushScene(new CleanScene(state.pet.species));
    changed();
  },
  heal() {
    if (!readyForAction()) return;
    const result = heal(state);
    if (!result.ok) return fail(result);
    play('ok');
    logCare(state, 'heal', '아픈 몸을 치료했어요');
    pushScene(new IconScene(state.pet.species, 'heart'));
    changed();
  },
  lights() {
    if (!readyForAction()) return;
    const result = toggleLights(state);
    if (!result.ok) return fail(result);
    play('tap');
    logCare(state, 'lights', result.lightsOn ? '불을 켰어요' : '편히 자도록 불을 껐어요');
    toast(result.lightsOn ? '불을 켰어요' : '불을 껐어요. 잘 자!');
    changed();
  },
};

$('#actions').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-act]');
  if (!button || !$('#actions').contains(button) || button.disabled) return;
  unlockAudio();
  play('tap');
  ACTIONS[button.dataset.act]?.();
});
$('#btn-egg').addEventListener('click', () => { unlockAudio(); openEggPicker(); });

function tapScene() {
  if (sheet.open || document.hidden) return;
  unlockAudio();
  if (interaction && !samePet(interaction)) {
    resetScenes();
    advanceClock();
    changed();
    return;
  }
  scene.tap();
  updateSceneUi();
}
canvas.addEventListener('pointerdown', tapScene);
canvas.addEventListener('keydown', (event) => {
  if (event.key === ' ' || event.key === 'Enter' || event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) tapScene();
  }
});
$('#btn-tap')?.addEventListener('click', tapScene);

function frame(now) {
  const delta = Math.max(0, Math.min(200, now - lastFrame));
  lastFrame = now;
  if (!document.hidden) {
    if (interaction && !samePet(interaction)) {
      resetScenes();
      advanceClock();
      changed();
    }
    const current = scene;
    current.update(delta);
    // Completion callbacks can replace scene with a newly evolved pet's scene.
    if (scene === current && current.done) scene = sceneQueue.shift() || idle;
    scene.draw(lcd);
    updateSceneUi();
  }
  requestAnimationFrame(frame);
}

// Sheet contents use text nodes, including user-provided names and friend codes.
function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (value === true) element.setAttribute(key, '');
    else if (value !== false && value != null) element.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

function openSheet(title, nodes) {
  text($('#sheet-title'), title);
  $('#sheet-body').replaceChildren(...nodes);
  if ($('#sheet-status')) {
    text($('#sheet-status'), '');
    $('#sheet-status').hidden = true;
  }
  if (!sheet.open) sheet.showModal();
  $('#sheet-body').scrollTop = 0;
  updateSceneUi();
}

function closeSheet() {
  if (sheet.open) sheet.close();
  updateSceneUi();
}
sheet.addEventListener('click', (event) => { if (event.target === sheet) closeSheet(); });
sheet.addEventListener('close', updateSceneUi);

function thumb(species, options) {
  const element = h('canvas', { class: 'thumb', 'aria-label': options?.silhouette ? '아직 만나지 못한 몬스터' : speciesLabel(species) });
  drawThumb(element, species, options);
  return element;
}

function fmtDuration(minutes) {
  if (minutes == null) return '-';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remaining = Math.floor(minutes % 60);
  if (days) return `${days}일 ${hours}시간`;
  if (hours) return `${hours}시간 ${remaining}분`;
  return `${remaining}분`;
}

function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.map(([key, value]) => [h('dt', {}, key), h('dd', {}, value)]));
}

function openStatus() {
  const pet = state.pet;
  if (!pet) return fail({ reason: 'none' });
  const species = speciesOf(pet.species);
  const left = minutesToEvolve(pet);
  const rate = pet.stageBattles ? `${Math.round(pet.stageWins / pet.stageBattles * 100)}%` : '-';
  const nameInput = h('input', { value: pet.name, maxlength: 8, placeholder: species.name, 'aria-label': '몬스터 이름' });
  openSheet('상태', [
    h('div', { class: 'card' }, thumb(pet.species), h('div', { class: 'grow' },
      h('b', {}, petName(pet)), h('div', { class: 'sub' }, `${speciesLabel(pet.species)} · ${STAGE_LABEL[species.stage]}`),
      h('div', { class: 'sub' }, species.desc || ''))),
    kv([
      ['나이', fmtDuration(pet.ageMin)], ['몸무게', `${pet.weight}g`],
      ['배고픔', hearts(pet.hunger)], ['힘', hearts(pet.strength)], ['대전력', battlePower(pet)],
      ['다음 진화', pet.dead ? '-' : left == null ? '최종 단계' : left === 0 ? '진화 조건 달성을 기다려요' : `${fmtDuration(left)} 뒤`],
      ['상태', pet.dead ? DEATH_TEXT[pet.deathCause] || '세상을 떠났어요' : pet.sick ? '아파요' : pet.asleep ? '자는 중' : '깨어 있어요'],
    ]),
    h('h3', {}, '이번 단계 기록 (진화 조건)'),
    kv([
      ['대전', `${pet.stageBattles}전 ${pet.stageWins}승 (${rate})`],
      ['훈련 성공', pet.stageTrain], ['과식', pet.overfeed], ['케어 실수', pet.stageMistakes],
    ]),
    h('h3', {}, '통산'),
    kv([
      ['대전', `${pet.battles}전 ${pet.wins}승`], ['훈련 성공', pet.trainTotal],
      ['케어 실수', pet.mistakes], ['진화 경로', pet.path.map((id) => speciesOf(id).name).join(' → ')],
    ]),
    h('h3', {}, '이름 짓기'),
    h('div', { class: 'row2' }, nameInput, h('button', { onclick: () => {
      if (state.pet !== pet) return toast('몬스터가 바뀌었어요. 상태를 다시 열어 주세요');
      if (/[\u0000-\u001f\u007f]/u.test(nameInput.value)) {
        return toast('이름에 탭이나 제어문자를 사용할 수 없어요');
      }
      rename(state, nameInput.value);
      const saved = changed();
      openStatus();
      toast(saved ? '이름을 바꾸고 저장했어요' : '이름은 바뀌었지만 저장에 실패했어요. 백업해 주세요');
    } }, '이름 저장')),
  ]);
}

function openBattle() {
  if (!readyForAction()) return;
  const allowed = canBattle(state);
  if (!allowed.ok) return fail(allowed);
  openSheet('대전', [
    h('button', { class: 'primary', onclick: () => { closeSheet(); wildBattle(); } }, '야생 몬스터와 대전'),
    h('button', { onclick: openFriend }, '친구와 대전 (코드 교환)'),
    h('p', { class: 'muted' }, `내 대전력 ${battlePower(state.pet)} · 대전하면 배고픔이 줄고, 지면 다칠 수 있어요.`),
  ]);
}

function startBattle(opponent, rng) {
  const token = snapshotPet();
  const result = simulateBattle(battlePower(state.pet), opponent.power, rng);
  const won = result.winner === 'A';
  const battle = new BattleScene(state.pet.species, opponent.species, result, () => {
    finishInteraction(token, () => {
      const applied = applyBattleResult(state, won, rng);
      logCare(state, 'battle', won ? '대전에서 승리했어요' : '대전을 마쳤어요');
      toast(won ? '승리!' : applied.injured ? '패배… 다쳐서 아파요' : '패배…');
    });
  });
  token.scene = battle;
  interaction = token;
  pushScene(battle);
  closeSheet();
  toast(`${opponent.name} 등장!`);
  canvas.focus();
}

function wildBattle() {
  if (!readyForAction()) return;
  const allowed = canBattle(state);
  if (!allowed.ok) return fail(allowed);
  startBattle(makeWildOpponent(state.pet, Math.random), Math.random);
}

function openFriend() {
  if (!readyForAction()) return;
  const allowed = canBattle(state);
  if (!allowed.ok) return fail(allowed);
  const pet = state.pet;
  const myCode = encodeFriendCode(pet);
  const input = h('textarea', { placeholder: '친구 코드 붙여넣기 (DOT-…)', 'aria-label': '친구 코드' });
  openSheet('친구 대전', [
    h('p', {}, '내 코드를 친구에게 보내고, 친구 코드를 받아 붙여넣으세요. 코드는 생성할 당시의 모습과 대전력을 담아요. 대전은 내 기기에서 진행되고 내 전적에 기록돼요.'),
    h('label', { class: 'field' }, '내 코드', h('textarea', { readonly: true, 'aria-label': '내 친구 대전 코드' }, myCode)),
    h('div', { class: 'row2' },
      h('button', { onclick: () => copyText(myCode) }, '복사'),
      h('button', { onclick: () => shareText(`${GAME_TITLE} 대전 코드`, myCode) }, '공유')),
    h('label', { class: 'field' }, '친구 코드', input),
    h('button', { class: 'primary', onclick: () => {
      const friend = decodeFriendCode(input.value);
      if (!friend || !friend.id || ['egg', 'baby', 'child'].includes(speciesOf(friend.species).stage)) return toast('대전할 수 있는 친구 코드를 입력해 주세요');
      if (friend.id === state.pet?.id) return toast('내 코드예요');
      if (!readyForAction()) return;
      const current = canBattle(state);
      if (!current.ok) return fail(current);
      startBattle(friend, Math.random);
    } }, '대전 시작'),
  ]);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast('복사했어요');
  } catch {
    openSheet('직접 복사', [
      h('p', {}, '자동 복사를 사용할 수 없어요. 아래 코드를 선택해서 복사해 주세요.'),
      h('textarea', { readonly: true, 'aria-label': '복사할 코드' }, value),
    ]);
    $('#sheet-body textarea').select();
  }
}

async function shareText(title, value) {
  if (!navigator.share) return copyText(value);
  try { await navigator.share({ title, text: value }); } catch { /* User may cancel. */ }
}

function motionOptions() {
  return { reducedMotion: state.extras.reducedMotion || Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) };
}

function playTogether() {
  if (!readyForAction()) return;
  const result = playWithPet(state);
  if (!result.ok) return result.reason === 'cooldown' ? toast(`${result.left}초 뒤 다시 놀 수 있어요`) : fail(result);
  closeSheet();
  pushScene(new PlayScene(state.pet.species, motionOptions()));
  changed();
  toast('함께 놀았어요. 친밀도 +3');
}

function fillHearts(kind) {
  if (!readyForAction()) return;
  const field = kind === 'meat' ? 'hunger' : 'strength';
  const count = MAX_HEARTS - state.pet[field];
  if (count <= 0) return toast('이미 충분히 채워져 있어요. 과식시키지 않을게요');
  let fed = 0;
  for (let i = 0; i < count; i++) {
    const result = kind === 'meat' ? feedMeat(state) : feedVitamin(state);
    if (!result.ok) return fail(result);
    if (result.full) break;
    fed++;
    logCare(state, kind === 'meat' ? 'feed' : 'vitamin', `${kind === 'meat' ? '식사' : '비타민'} ${i + 1}/${count}회 챙겼어요`);
  }
  closeSheet();
  pushScene(new EatScene(state.pet.species, kind, false));
  changed();
  toast(`${fed}회 먹고 ${kind === 'meat' ? '배고픔' : '힘'}을 채웠어요`);
}

function openCare() {
  openSheet('빠른 돌보기', [
    h('p', {}, '필요한 만큼만 채워 과식을 막아요. 알·수면·질병 상태를 확인하고 직접 돌봐 주세요.'),
    h('div', { class: 'row2' },
      h('button', { class: 'primary', onclick: () => fillHearts('meat') }, '식사 충분히 주기'),
      h('button', { onclick: () => fillHearts('pill') }, '비타민 채우기'),
      h('button', { onclick: () => { closeSheet(); ACTIONS.clean(); } }, '청소하기'),
      h('button', { onclick: () => { closeSheet(); ACTIONS.heal(); } }, '치료하기'),
      h('button', { onclick: () => { closeSheet(); ACTIONS.lights(); } }, '불 켜기 / 끄기'),
      h('button', { onclick: playTogether }, '함께 놀기')),
  ]);
}

function openDaily() {
  const extras = ensureExtras(state);
  openSheet('오늘의 돌봄', [
    h('p', {}, '매일 작은 관심을 모아 보세요. 목표와 친밀도는 진화 조건이나 대전력을 바꾸지 않아요.'),
    ...TASKS.map(task => h('div', { class: 'task-row' }, h('span', {}, task.label),
      h('b', {}, `${extras.daily.counts[task.id]}/${task.goal}`),
      h('progress', { value: extras.daily.counts[task.id], max: task.goal, 'aria-label': task.label }))),
    h('button', { onclick: openCare }, '돌보러 가기'),
  ]);
}

function openJournal() {
  const entries = ensureExtras(state).journal;
  openSheet('돌봄 일지', [
    h('p', { class: 'muted' }, '최근 80개의 기록을 백업과 함께 보관해요.'),
    entries.length ? h('div', { class: 'journal' }, entries.map(entry => h('article', { class: 'journal-entry' },
      h('time', { datetime: new Date(entry.at).toISOString() }, new Date(entry.at).toLocaleString('ko-KR')),
      h('p', {}, entry.label)))) : h('p', {}, '첫 번째 돌봄을 기다리고 있어요.'),
  ]);
}

function openCustomize() {
  const extras = state.extras;
  const reduced = h('input', { type: 'checkbox', checked: extras.reducedMotion });
  const names = { moss: '포레스트 링크', cobalt: '코발트 링크', amber: '앰버 링크' };
  openSheet('기기 꾸미기', [
    h('p', {}, '기기 색상을 고르고 진화 연출의 움직임을 조절해요.'),
    h('div', { class: 'theme-options' }, THEMES.map(theme => h('button', {
      class: `theme-swatch theme-${theme}`, 'aria-pressed': String(theme === extras.theme), onclick: () => {
        extras.theme = theme; changed(); openCustomize(); toast(`${names[theme]}로 바꿨어요`);
      },
    }, names[theme]))),
    h('label', { class: 'check' }, reduced, '진화 연출 동작 줄이기'),
    h('button', { onclick: () => { extras.reducedMotion = reduced.checked; changed(); toast('연출 설정을 저장했어요'); } }, '연출 설정 저장'),
    h('button', { onclick: replayEvolution }, '최근 진화 다시보기'),
  ]);
}

function replayEvolution() {
  if (!readyForAction()) return;
  const path = state.pet.path;
  if (path.length < 2) return toast('아직 부화 또는 진화 기록이 없어요');
  const from = path[path.length - 2];
  const to = path[path.length - 1];
  closeSheet();
  pushScene(new EvolveScene(from, to, from === 'egg', motionOptions()));
  toast('최근 진화 다시보기 · 기록과 능력치는 바뀌지 않아요');
}

function openRest() {
  const paused = state.extras.restUntil > Date.now();
  openSheet('휴식 모드', [
    h('p', {}, paused ? '지금 게임 시간이 멈춰 있어요. 휴식이 끝난 뒤의 시간부터 다시 흘러요.' : '바쁜 시간에는 돌보기를 잠시 쉬어요. 휴식 중에는 배고픔·성장·진화와 예약 알림이 모두 멈춰요.'),
    paused ? h('button', { class: 'primary', onclick: () => {
      advanceClock(false);
      state.extras.restUntil = 0;
      state.lastReal = Date.now() - state.extras.restRemainder / state.settings.speed;
      state.extras.restRemainder = 0;
      logCare(state, 'resume', '휴식을 마치고 다시 함께해요');
      closeSheet(); changed(); toast('휴식을 마쳤어요');
    } }, '지금 휴식 끝내기') : h('div', { class: 'row2' }, [30, 120, 480].map(minutes => h('button', { onclick: () => {
      if (!readyForAction()) return;
      const now = Date.now();
      state.extras.restUntil = now + minutes * 60000;
      state.extras.restRemainder = Math.max(0, Math.min(59999.999, (now - state.lastReal) * state.settings.speed));
      state.lastReal = now - state.extras.restRemainder / state.settings.speed;
      logCare(state, 'rest', `${minutes < 60 ? `${minutes}분` : `${minutes / 60}시간`} 휴식을 시작했어요`);
      closeSheet(); changed(); toast('게임 시간과 돌봄 알림을 잠시 멈췄어요');
    } }, minutes < 60 ? '30분 쉬기' : `${minutes / 60}시간 쉬기`))),
  ]);
}

let pushSyncBusy = false;
let pushSyncAgain = false;
let lastPushSync = 0;
let pushNotice = null;
let pushUiVersion = 0;
const pushController = createPushController({
  getState: () => state,
  client: { enablePush, syncPush, disablePush },
  onPersist: persist,
  onStatus: result => {
    pushUiVersion++;
    const labels = { enabled: '푸시 연결됨', paused: '푸시 예약 쉬는 중', disabled: '푸시 꺼짐', disable_pending: '푸시 해제 확인 필요', reconnect_needed: '푸시 재연결 필요' };
    text($('#push-status'), labels[result.phase] || '푸시 설정 필요');
    if (pushNotice?.isConnected) text(pushNotice, result.message ||
      (result.phase === 'enabled' ? `푸시 연결됨 · ${result.scheduled}개 예약` :
        result.phase === 'paused' ? '구독은 연결됐지만 휴식·배속 중이라 예약은 비웠어요' :
          result.phase === 'disabled' ? '푸시 구독과 예약을 해제했어요' :
            result.phase === 'disable_pending' ? '해제를 확인하지 못했어요. 온라인에서 다시 꺼 주세요' : '푸시 연결 또는 예약 갱신을 확인하지 못했어요'));
  },
});
async function refreshPush(force = false) {
  if (pushSyncBusy) { pushSyncAgain = pushSyncAgain || force; return; }
  if (!force && Date.now() - lastPushSync < 60000) return;
  pushSyncBusy = true;
  lastPushSync = Date.now();
  try {
    await pushController.sync(force);
  } catch { text($('#push-status'), '푸시 재연결 필요'); }
  finally {
    pushSyncBusy = false;
    if (pushSyncAgain) { pushSyncAgain = false; void refreshPush(true); }
  }
}

function openPushSettings() {
  const preferences = state.extras.notifications;
  const inspectionVersion = ++pushUiVersion;
  let serverReady = false;
  const labels = { hunger: '식사', strength: '힘 / 비타민', clean: '청소', sick: '질병', lights: '취침 / 불', evolve: '부화 / 진화' };
  const status = h('p', { class: 'push-note', role: 'status', 'aria-live': 'polite' }, '푸시 연결 상태를 확인하고 있어요…');
  pushNotice = status;
  const boxes = Object.fromEntries(CATEGORIES.map(key => [key, h('input', { type: 'checkbox', checked: preferences.categories[key] })]));
  const hourSelect = selected => h('select', {}, Array.from({ length: 24 }, (_, value) => h('option', { value, selected: selected === value }, `${value}시`)));
  const quietStart = hourSelect(preferences.quietStart);
  const quietEnd = hourSelect(preferences.quietEnd);
  const applyPrefs = () => {
    for (const key of CATEGORIES) preferences.categories[key] = boxes[key].checked;
    preferences.quietStart = Number(quietStart.value);
    preferences.quietEnd = Number(quietEnd.value);
  };
  const enable = h('button', { class: 'primary', disabled: true, onclick: () => {
    if (state.extras.notifications !== preferences) return toast('상태가 바뀌었어요. 알림 설정을 다시 열어 주세요');
    applyPrefs();
    pushUiVersion++;
    enable.disabled = true;
    // Call directly from the click: iOS requires permission requests in a user gesture.
    const request = pushController.enable();
    void request.then(result => {
      if (result.stale || state.extras.notifications !== preferences) return;
      enable.disabled = !serverReady;
    }).catch(() => { text(status, '푸시 연결을 완료하지 못했어요'); enable.disabled = false; });
  } }, '휴대폰 푸시 알림 켜기');
  openSheet('휴대폰 푸시 알림', [
    status,
    h('p', {}, '앱이 닫혀 있어도 받는 Web Push예요. HTTPS 게임 주소와 운영 중인 알림 서버를 연결해야 해요. 서버가 없으면 켜짐으로 표시하지 않아요.'),
    h('p', { class: 'muted' }, '아이폰: iOS 16.4 이상에서 홈 화면에 추가한 앱으로 열고 구독해 주세요. 알림 버튼이 안 보이면 본문을 탭해 돌보러 와요.'),
    h('h3', {}, '받을 알림'),
    h('div', { class: 'row2' }, CATEGORIES.map(key => h('label', { class: 'check' }, boxes[key], labels[key]))),
    h('h3', {}, '방해 금지 시간'),
    h('div', { class: 'row2' }, h('label', { class: 'field' }, '시작', quietStart), h('label', { class: 'field' }, '끝', quietEnd)),
    h('p', { class: 'muted' }, '시작과 끝이 같으면 항상 허용해요. 24시간 예측이므로 하루에 한 번 게임을 열어 갱신해 주세요. 휴식·배속 중에는 예약을 비워요.'),
    enable,
    h('button', { onclick: () => { applyPrefs(); changed(); toast('알림 종류와 방해 금지 시간을 저장했어요'); } }, '알림 설정 저장'),
    h('div', { class: 'row2' },
      h('button', { onclick: async () => { const result = await testPush(state); text(status, result.message || '테스트 알림 요청을 보냈어요'); } }, '테스트 알림'),
      h('button', { onclick: async () => {
        pushUiVersion++;
        const result = await pushController.disable();
        if (!result.stale) enable.disabled = !serverReady;
      } }, '푸시 알림 끄기')),
  ]);
  void inspectPushStatus().then(result => {
    if (!status.isConnected || pushUiVersion !== inspectionVersion) return;
    serverReady = result.serverAvailable && result.supported;
    enable.disabled = !serverReady;
    text(status, result.message || (result.enabled ? `푸시 연결됨 · ${result.scheduled}개 예약` : '아직 푸시를 구독하지 않았어요'));
    text($('#push-status'), result.enabled ? '푸시 연결됨' : result.serverAvailable ? '푸시 꺼짐' : '푸시 설정 필요');
  }).catch(() => text(status, '푸시 상태를 확인하지 못했어요'));
}

function openNotificationCare(care, petId = '') {
  if (!['feed', 'vitamin', 'clean', 'heal', 'lights', 'open'].includes(care)) return;
  if (!interaction) advanceClock(false);
  const pet = state.pet;
  if (petId && petId !== pet?.id) {
    openSheet('지난 돌봄 알림', [h('p', {}, '알림을 보낸 몬스터와 지금 몬스터가 달라요. 이전 알림으로는 자동 돌보기하지 않아요.'), h('button', { onclick: openCare }, '현재 몬스터 확인하기')]);
    return;
  }
  const token = pet;
  const title = { feed: '식사 챙기기', vitamin: '비타민 주기', clean: '청소하기', heal: '치료하기', lights: '불 확인하기', open: '성장 확인하기' }[care];
  openSheet(title, [
    h('div', { class: 'card' }, thumb(pet.species), h('div', { class: 'grow' }, h('b', {}, petName(pet)), h('p', { class: 'sub' }, moodOf(pet, state.extras)))),
    h('p', {}, '예약 당시와 현재 상태가 다를 수 있어요. 상태를 확인한 뒤 돌봐 주세요.'),
    h('button', { class: 'primary', onclick: () => {
      if (state.pet !== token) return toast('몬스터가 바뀌었어요. 알림을 다시 확인해 주세요');
      if (care === 'open') { openStatus(); return; }
      if (care === 'feed' || care === 'vitamin') fillHearts(care === 'feed' ? 'meat' : 'pill');
      else { closeSheet(); ACTIONS[care](); }
    } }, title),
    h('button', { onclick: openCare }, '모든 돌보기 보기'),
  ]);
}

document.querySelectorAll('[data-extra]').forEach(button => button.addEventListener('click', () => {
  unlockAudio();
  ({ play: playTogether, care: openCare, daily: openDaily, rest: openRest, push: openPushSettings })[button.dataset.extra]?.();
}));

function openMenu() {
  openSheet('메뉴', [
    h('h3', {}, '매일 함께'),
    h('div', { class: 'row2' }, h('button', { onclick: openDaily }, '오늘의 돌봄'),
      h('button', { onclick: openJournal }, '돌봄 일지'), h('button', { onclick: openRest }, '휴식 모드'),
      h('button', { onclick: openCustomize }, '기기 꾸미기')),
    h('h3', {}, '연결과 기록'),
    h('div', { class: 'row2' },
      h('button', { onclick: openDex }, '도감'),
      h('button', { onclick: openRecords }, '기록'),
      h('button', { onclick: openPushSettings }, '휴대폰 푸시 알림'),
      h('button', { onclick: openSettings }, '설정'),
      h('button', { onclick: openHelp }, '도움말')),
    h('button', { onclick: openEggPicker }, '새 알 받기'),
  ]);
}

function openEggPicker() {
  const pet = state.pet;
  openSheet('새 알 받기', [
    h('div', { class: 'card' }, thumb('egg'), h('div', { class: 'grow' }, h('b', {}, speciesLabel('egg')), h('div', { class: 'sub' }, '게임 시간 1분 뒤 부화해요'))),
    h('p', {}, pet && !pet.dead ? `지금 키우는 ${petName(pet)} 대신 새 알을 받아요. 이 선택은 되돌릴 수 없어요.` : '지난 몬스터를 기록에 남기고 새 알을 받아요.'),
    h('button', { class: pet && !pet.dead ? 'danger' : 'primary', onclick: () => {
      if (!confirm('지금 몬스터 대신 새 알을 받을까요? 되돌릴 수 없어요.')) return;
      resetScenes();
      advanceClock(false);
      newEgg(state);
      ensureExtras(state);
      logCare(state, 'new', '새 알과의 만남을 시작했어요');
      awayEvents = [];
      awayClock = null;
      closeSheet();
      play('ok');
      changed();
      toast('새 알을 받았어요');
    } }, '새 알 받기'),
  ]);
}

function openDex() {
  const seen = (id) => Boolean(state.dex[id]);
  const count = SPECIES_ORDER.filter(seen).length;
  openSheet(`도감 ${count}/${SPECIES_ORDER.length}`, [
    h('div', { class: 'dex' }, SPECIES_ORDER.map((id) =>
      h('button', { onclick: () => openDexEntry(id) }, thumb(id, { silhouette: !seen(id) }),
        seen(id) ? speciesLabel(id) : '???', h('span', { class: 'muted' }, STAGE_LABEL[SPECIES[id].stage])))),
  ]);
}

function openDexEntry(id) {
  const species = speciesOf(id);
  const known = Boolean(state.dex[id]);
  const name = (key) => state.dex[key] ? speciesLabel(key) : '???';
  // Parent links are derived from the v1 species graph; no newer tree API needed.
  const parents = SPECIES_ORDER.filter((key) => SPECIES[key].evolutions.some((rule) => rule.to === id));
  const children = [...new Set(species.evolutions.map((rule) => rule.to))];
  openSheet(known ? speciesLabel(id) : '???', [
    h('div', { class: 'card' }, thumb(id, { silhouette: !known }), h('div', { class: 'grow' },
      h('b', {}, known ? speciesLabel(id) : '???'), h('div', { class: 'sub' }, STAGE_LABEL[species.stage]))),
    h('p', {}, known ? species.desc || '' : species.hint || '아직 만나지 못했어요.'),
    known && species.hint ? h('p', { class: 'muted' }, `진화 힌트: ${species.hint}`) : null,
    parents.length ? h('p', { class: 'muted' }, `이전 단계: ${parents.map(name).join(', ')}`) : null,
    children.length ? h('p', { class: 'muted' }, `다음 단계: ${children.map(name).join(', ')}`) : null,
    h('button', { onclick: openDex }, '도감으로 돌아가기'),
  ]);
}

function openRecords() {
  openSheet('지난 몬스터 기록', [
    state.graveyard.length ? h('div', { class: 'list' }, state.graveyard.map((record) =>
      h('div', { class: 'card' }, thumb(record.species), h('div', { class: 'grow' },
        h('b', {}, record.name || SPECIES[record.species]?.name || record.species),
        h('div', { class: 'sub' }, speciesLabel(record.species)),
        h('div', { class: 'sub' }, `${fmtDuration(record.ageMin)} · ${DEATH_TEXT[record.cause] || record.cause} · ${record.battles}전 ${record.wins}승 · 실수 ${record.mistakes}`),
        h('div', { class: 'sub' }, (record.path || []).map((id) => SPECIES[id]?.name || id).join(' → '))))))
      : h('p', { class: 'muted' }, '아직 기록이 없어요.'),
  ]);
}

function exportBackup() {
  if (!interaction) advanceClock();
  persist();
  const code = encodeSave(state);
  return copyText(code);
}

function importBackup(value) {
  const raw = decodeSave(value);
  const imported = raw && migrate(raw);
  if (!imported) return toast('백업 코드를 읽을 수 없어요. 현재 진행은 그대로예요');
  if (!confirm('지금 진행 상황을 백업으로 덮어쓸까요? 되돌릴 수 없어요.')) return;
  const storageStatus = storage.getStorageStatus?.();
  if (storageStatus?.reason === 'corrupt' || (storageStatus?.recovered && !storageStatus.canSave)) {
    // Automatic saving preserves damaged slots. Only this explicit restore
    // confirmation permits clearing them, never an ordinary tick or load.
    if (!confirm('손상된 저장 데이터를 지우고 이 백업으로 복구할까요? 손상된 원본은 지워져요.')) return;
    if (!clearState()) return toast('손상된 저장 데이터를 지우지 못했어요. 현재 진행은 그대로예요');
  }
  resetScenes();
  const hadPush = state.extras.notifications.enabled;
  state = imported;
  ensureExtras(state);
  void pushController.replaceState(hadPush);
  awayEvents = [];
  awayClock = null;
  interruptedAway = false;
  initialLoadWarning = '';
  wasCalling = false;
  setSoundEnabled(state.settings.sound);
  closeSheet();
  // Preserve imported.lastReal: offline time in a backup is real elapsed time.
  catchUp();
  const saved = persist();
  toast(saved ? '백업을 불러왔어요. 지난 시간도 반영했어요' : '백업을 불러왔지만 저장에 실패했어요. 백업 코드를 보관해 주세요');
}

function openSettings() {
  const settings = state.settings;
  const hours = (selected) => h('select', {}, Array.from({ length: 24 }, (_, hour) =>
    h('option', { value: hour, selected: hour === selected }, `${hour}시`)));
  const sleep = hours(settings.sleepHour);
  const wake = hours(settings.wakeHour);
  const sound = h('input', { type: 'checkbox', checked: settings.sound });
  const speeds = [...new Set([1, 10, 60, 600, settings.speed])].sort((a, b) => a - b);
  const speed = h('select', {}, speeds.map((value) => h('option', { value, selected: value === settings.speed },
    value === 1 ? '실제 시간 (기본)' : `${value}배 빠르게 (테스트용)`)));
  const backup = h('textarea', { placeholder: '백업 코드 (DOTSAVE-…)', 'aria-label': '불러올 백업 코드' });
  openSheet('설정', [
    h('div', { class: 'row2' }, h('label', { class: 'field' }, '잠드는 시각', sleep), h('label', { class: 'field' }, '일어나는 시각', wake)),
    h('label', { class: 'check' }, sound, '소리와 진동'),
    h('label', { class: 'field' }, '시간 속도', speed),
    h('button', { class: 'primary', onclick: () => {
      if (interaction) return toast('훈련 또는 대전이 끝난 뒤 설정을 저장해 주세요');
      const realNow = Date.now();
      const oldSpeed = state.settings.speed;
      advanceClock(true, realNow); // Advance up to the boundary using OLD settings.
      const remainder = Math.max(0, realNow - state.lastReal) * oldSpeed;
      const nextSpeed = Number(speed.value);
      Object.assign(state.settings, {
        sleepHour: Number(sleep.value), wakeHour: Number(wake.value), sound: sound.checked, speed: nextSpeed,
      });
      // Core keeps sub-minute time in lastReal. Rebase that remainder so changing
      // speed neither reweights already elapsed seconds nor drops partial time.
      state.lastReal = realNow - remainder / nextSpeed;
      setSoundEnabled(state.settings.sound);
      unlockAudio();
      const saved = changed();
      toast(saved ? '설정을 저장했어요' : '설정은 적용됐지만 저장에 실패했어요. 백업해 주세요');
    } }, '설정 저장'),
    h('button', { onclick: openPushSettings }, '휴대폰 푸시 알림 설정'),
    h('p', { class: 'muted' }, '앱을 닫아도 오는 푸시는 HTTPS 게임과 운영 중인 알림 서버를 연결해야 해요. 배속은 돌봄 시간도 빨라지며 예약 푸시는 중지돼요.'),
    h('h3', {}, '백업 / 기기 이동'),
    h('div', { class: 'row2' }, h('button', { onclick: exportBackup }, '백업 코드 복사'),
      h('button', { onclick: () => importBackup(backup.value) }, '백업 불러오기')),
    backup,
    h('h3', {}, '초기화'),
    h('button', { class: 'danger', onclick: () => {
      if (!confirm('모든 진행과 도감, 기록을 지우고 처음부터 시작할까요? 되돌릴 수 없어요.')) return;
      if (!clearState()) {
        text($('#save-status'), '초기화 실패 · 백업 필요');
        return toast('초기화에 실패했어요. 현재 진행은 그대로예요');
      }
      resetScenes();
      const hadPush = state.extras.notifications.enabled;
      state = loadState();
      ensureExtras(state);
      void pushController.replaceState(hadPush);
      awayEvents = [];
      awayClock = null;
      interruptedAway = false;
      initialLoadWarning = '';
      wasCalling = false;
      setSoundEnabled(state.settings.sound);
      closeSheet();
      const saved = changed();
      toast(saved ? '초기화했어요. 새 알을 돌봐 주세요' : '초기화했지만 새 진행을 저장하지 못했어요. 백업해 주세요');
    } }, '처음부터 다시 하기'),
  ]);
}

function openHelp() {
  const standalone = globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  openSheet('도움말', [
    h('p', {}, '알에서 태어난 몬스터를 실제 시간으로 돌봐요. 앱을 꺼 둔 동안에도 시간은 흘러요.'),
    h('h3', {}, '돌보기'),
    h('p', {}, '배고픔·힘이 0이 되면 몬스터가 불러요. 오래 방치하면 케어 실수가 쌓이고, 똥이 4개 쌓이면 병에 걸려요. 잘 시간에는 불을 꺼 주세요.'),
    h('p', {}, '빠른 돌보기로 필요한 하트만 채워 과식을 막아요. 함께 놀기는 1분마다 친밀도를 높여요. 오늘 목표와 일지는 기록용이며 진화나 대전 조건을 바꾸지 않아요.'),
    h('h3', {}, '바쁠 때는 휴식'),
    h('p', {}, '메뉴에서 30분·2시간·8시간 휴식을 선택하면 게임 시간과 예약 알림이 멈춰요. 해제 또는 만료 뒤부터 시간이 다시 흘러요.'),
    h('h3', {}, '진화 연출과 꾸미기'),
    h('p', {}, '기기 꾸미기에서 3가지 테마, 동작 줄이기와 최근 진화 다시보기를 선택해요. 다시보기는 기록이나 능력치를 바꾸지 않아요.'),
    h('h3', {}, '진화'),
    h('p', {}, '단계마다 정해진 시간이 지나면 케어 실수, 훈련, 과식, 대전 기록으로 다음 모습이 정해져요. 성숙기에서 완전체로 진화하려면 이번 단계 8전 이상, 승률 60% 이상이 필요해요. 상태 화면과 도감을 참고해 주세요.'),
    h('h3', {}, '훈련 · 대전'),
    h('p', {}, '훈련은 오른쪽 게이지가 6칸 이상일 때 화면이나 탭 버튼을 눌러요. 화면에 초점을 맞추고 Space 또는 Enter로도 탭할 수 있어요. 5번 중 3번 맞히면 성공이에요. 대전은 성장기부터 할 수 있어요.'),
    h('p', {}, '훈련과 대전 중에는 게임 시간 반영을 잠시 미뤄요. 끝나면 지난 시간이 모두 반영돼요. 화면을 떠나면 진행 중인 경기는 취소되며 결과는 기록되지 않아요.'),
    !standalone ? h('h3', {}, '홈 화면에 설치') : null,
    !standalone ? h('p', {}, '아이폰: 사파리 공유 버튼에서 홈 화면에 추가. 안드로이드: 브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가.') : null,
  ]);
}

// Storage implementations may offer load-error diagnostics in addition to booleans.
if (typeof storage.getStorageStatus === 'function') {
  initialLoadWarning = storageWarning(storage.getStorageStatus());
}
catchUp();
wasCalling = callReasons(state.pet).length > 0;
updateHud();
requestAnimationFrame(frame);
setInterval(tick, 1000);

function enterAway() {
  if (awayClock === null) awayClock = state.clock;
  interruptedAway = interruptedAway || Boolean(interaction);
  resetScenes();
  awayEvents.push(...advanceClock(false));
  persist();
}

document.addEventListener('visibilitychange', () => {
  lastFrame = performance.now();
  if (document.hidden) enterAway();
  else catchUp();
});
window.addEventListener('pagehide', enterAway);
window.addEventListener('online', () => { void refreshPush(); });
setInterval(() => { void refreshPush(); }, 60000);
if (navigator.serviceWorker?.addEventListener) navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type === 'DOTMON_CARE') openNotificationCare(event.data.care, event.data.petId);
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted && !document.hidden) {
    lastFrame = performance.now();
    catchUp();
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// The original, intentionally small development interface.
globalThis.dotmon = { get state() { return state; }, save: () => persist() };
try {
  if (location.href) {
    const url = new URL(location.href);
    const care = url.searchParams.get('care');
    if (care) {
      openNotificationCare(care, url.searchParams.get('pet') || '');
      for (const key of ['care', 'pet', 'notice']) url.searchParams.delete(key);
      globalThis.history?.replaceState(null, '', url.href);
    }
  }
} catch { /* Invalid deep links cannot prevent game startup. */ }
void refreshPush();

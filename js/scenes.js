// LCD에 그리는 장면들. 각 장면은 update(dt) / draw(lcd) / tap()을 가진다.
// done이 true가 되면 컨트롤러가 기본 장면(Idle)으로 돌아간다.

import { LCD_W, LCD_H, POOP_MAX, TRAIN_ROUNDS, TRAIN_PASS } from './config.js';
import { callReasons } from './game.js';
import { speciesOf } from './species.js';
import { play, vibrate } from './sound.js';

const PET_Y = LCD_H - 16;

// ───────────── 기본 화면: 돌아다니기, 똥, 호출, 잠 ─────────────
export class IdleScene {
  constructor(getState) {
    this.getState = getState;
    this.x = 14;
    this.dir = -1;
    this.t = 0;
    this.step = 0;
  }

  update(dt) {
    this.t += dt;
    if (this.t < 600) return;
    this.t = 0;
    this.step++;
    const pet = this.getState().pet;
    if (!pet || pet.dead || pet.asleep) return;
    const egg = speciesOf(pet.species).stage === 'egg';
    if (egg) return;
    const maxX = LCD_W - 16 - (pet.poop > 0 ? 9 : 0);
    if (Math.random() < 0.25) this.dir *= -1;
    this.x += this.dir * (Math.random() < 0.5 ? 1 : 2);
    if (this.x < 0) (this.x = 0), (this.dir = 1);
    if (this.x > maxX) (this.x = maxX), (this.dir = -1);
  }

  draw(lcd) {
    const state = this.getState();
    const pet = state.pet;
    lcd.setDark(!!(pet && pet.asleep && !pet.lightsOn));
    lcd.clear();
    if (!pet) return;
    if (pet.dead) {
      lcd.icon('grave', 16, PET_Y);
      return;
    }
    const sp = speciesOf(pet.species);
    if (sp.stage === 'egg') {
      const wobble = this.step % 2 ? 1 : 0;
      lcd.monster(pet.species, 16 + wobble, PET_Y);
      return;
    }
    if (pet.asleep) {
      if (pet.lightsOn) lcd.monster(pet.species, 16, PET_Y);
      lcd.icon('zz', 36, 1);
    } else {
      const frame = this.step % 2;
      const bob = frame && sp.img == null ? 1 : 0;
      lcd.monster(pet.species, this.x, PET_Y - bob, { flip: this.dir > 0, frame });
    }
    // 똥: 오른쪽 아래부터 쌓는다
    for (let i = 0; i < Math.min(pet.poop, POOP_MAX); i++) {
      const px = LCD_W - 8 - Math.floor(i / 2) * 8;
      const py = LCD_H - 8 - (i % 2) * 8;
      lcd.icon(this.step % 2 ? 'poop1' : 'poop2', px, py);
    }
    if (pet.sick) lcd.icon('sick', 0, 0);
    if (callReasons(pet).length && this.step % 2) lcd.icon('call', LCD_W - 2, 0);
  }

  tap() {}
}

// ───────────── 먹기 ─────────────
export class EatScene {
  constructor(speciesId, kind, refused) {
    this.sp = speciesId;
    this.kind = kind; // 'meat' | 'pill'
    this.refused = refused;
    this.t = 0;
    this.done = false;
  }
  update(dt) {
    this.t += dt;
    if (this.t > 2400) this.done = true;
  }
  draw(lcd) {
    lcd.setDark(false);
    lcd.clear();
    const f = Math.floor(this.t / 600);
    if (this.refused) {
      lcd.monster(this.sp, 24, PET_Y, { flip: f % 2 === 1 });
      lcd.icon(this.kind + '3', 8, PET_Y + 8);
      return;
    }
    lcd.monster(this.sp, 24, PET_Y - (f % 2), { frame: f % 2 });
    const left = Math.max(1, 3 - f);
    if (f < 3) lcd.icon(this.kind + left, 10, PET_Y + 8);
  }
  tap() {
    this.done = true;
  }
}

// ───────────── 청소 ─────────────
export class CleanScene {
  constructor(speciesId) {
    this.sp = speciesId;
    this.t = 0;
    this.done = false;
  }
  update(dt) {
    this.t += dt;
    if (this.t > 1600) this.done = true;
  }
  draw(lcd) {
    lcd.setDark(false);
    lcd.clear();
    const x = Math.round(LCD_W - (this.t / 1200) * LCD_W);
    lcd.monster(this.sp, 8, PET_Y);
    for (let y = 0; y < LCD_H; y++) lcd.dot(x, y);
    for (let y = 0; y < LCD_H; y += 2) lcd.dot(x + 1, y);
  }
  tap() {}
}

// Presentation-only timelines: replay never calls the evolution/care engine.
const EVOLUTION_PHASES = ['charge', 'scan', 'morph', 'reveal', 'celebrate'];
const EVOLUTION_ENDS = [900, 1900, 3300, 4100, 5000];
const HATCH_ENDS = [650, 1200, 2150, 2850, 3500];
const ENERGY = '#48b9ac';
const SPARK = '#f2cf72';

function effectDot(lcd, x, y, color = ENERGY, alpha = 1) {
  x = Math.round(x);
  y = Math.round(y);
  if (lcd.effectDot) lcd.effectDot(x, y, { color, alpha });
  else lcd.dot(x, y);
}

function dataRing(lcd, radius, angle, count = 24, alpha = 0.8) {
  for (let i = 0; i < count; i++) {
    const a = angle + i * Math.PI * 2 / count;
    effectDot(lcd, 24 + Math.cos(a) * radius, 13 + Math.sin(a) * radius * 0.52, ENERGY, alpha);
  }
}

// Shared finite lifecycle; callbacks and scheduled audio are owned by the scene.
class PresentationScene {
  constructor(opts = {}) {
    this.opts = opts || {};
    this.reducedMotion = Boolean(this.opts.reducedMotion);
    this.t = 0;
    this.done = false;
    this.cancelled = false;
    this.onFinish = this.opts.onFinish;
    this._audio = [];
    this._cues = new Set();
  }
  cue(name) {
    if (this.done || this.opts.sound === false || this._cues.has(name)) return;
    this._cues.add(name);
    const stop = play(name);
    if (typeof stop === 'function') this._audio.push(stop);
  }
  stopAudio() {
    for (const stop of this._audio) stop();
    this._audio.length = 0;
  }
  finish() {
    if (this.done) return;
    this.done = true;
    this.stopAudio();
    const onFinish = this.onFinish;
    this.onFinish = null;
    onFinish?.();
  }
  cancel() {
    if (this.done) return;
    this.cancelled = true;
    this.done = true;
    this.onFinish = null;
    this.stopAudio();
  }
  getPhase() { return this.phase; }
}

// ───────────── 진화 / 부화 ─────────────
export class EvolveScene extends PresentationScene {
  constructor(from, to, hatch, opts = { reducedMotion: false }) {
    super(opts);
    this.from = from;
    this.to = to;
    this.hatch = Boolean(hatch);
    this.ends = this.hatch ? HATCH_ENDS : EVOLUTION_ENDS;
    this.duration = this.ends[this.ends.length - 1];
    this.cue(this.hatch ? 'hatchCharge' : 'evolveCharge');
    if (!this.reducedMotion && this.opts.sound !== false) vibrate(60);
  }
  get phaseIndex() {
    const index = this.ends.findIndex(end => this.t < end);
    return index < 0 ? this.ends.length - 1 : index;
  }
  get phase() {
    return this.cancelled ? 'cancelled' : this.done ? 'done' : EVOLUTION_PHASES[this.phaseIndex];
  }
  get phaseProgress() {
    const i = this.phaseIndex;
    const start = i ? this.ends[i - 1] : 0;
    return Math.max(0, Math.min(1, (this.t - start) / (this.ends[i] - start)));
  }
  update(dt) {
    if (this.done || !Number.isFinite(dt) || dt < 0) return;
    const previous = this.phase;
    this.t = Math.min(this.duration, this.t + dt);
    if (this.t >= this.duration) return this.finish();
    if (this.phase !== previous) this.cue(`evolve${this.phase[0].toUpperCase()}${this.phase.slice(1)}`);
  }
  draw(lcd) {
    if (this.cancelled) return;
    lcd.setDark(false);
    lcd.clear();
    const phase = this.done ? 'celebrate' : this.phase;
    const p = this.phaseProgress;
    const angle = this.reducedMotion ? 0 : this.t / 1400;
    const frame = this.reducedMotion ? 0 : Math.floor(this.t / 500) % 2;
    const actor = (id, opts = {}) => lcd.monster(id, 16, PET_Y, { frame, ...opts });

    if (phase === 'charge') {
      dataRing(lcd, this.reducedMotion ? 15 : 10 + 8 * p, angle, 16);
      actor(this.from);
      // Four packets converge without any full-screen flash or inversion.
      for (const side of [-1, 1]) for (const y of [7, 18]) {
        effectDot(lcd, 24 + side * (22 - 10 * p), y);
      }
    } else if (phase === 'scan') {
      dataRing(lcd, 18, angle);
      actor(this.from, { silhouette: true });
      const scanY = this.reducedMotion ? 14 : 5 + Math.floor(p * 17);
      for (let x = 12; x <= 35; x++) effectDot(lcd, x, scanY, ENERGY, 0.7);
      for (let y = 4; y < 22; y += 4) {
        effectDot(lcd, 7, y);
        effectDot(lcd, 40, y + 1);
      }
      if (this.hatch) lcd.icon('crack', 16, PET_Y);
    } else if (phase === 'morph') {
      dataRing(lcd, 18, angle, this.reducedMotion ? 16 : 28);
      if (this.reducedMotion) {
        // A single stable silhouette swap, never rapid alternating frames.
        actor(p < 0.5 ? this.from : this.to, { silhouette: true, frame: 0 });
      } else {
        actor(this.from, { silhouette: true, alpha: 1 - p });
        actor(this.to, { silhouette: true, alpha: p });
      }
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + angle;
        const r = this.reducedMotion ? 15 : 15 + Math.sin(p * Math.PI) * 5;
        effectDot(lcd, 24 + Math.cos(a) * r, 13 + Math.sin(a) * r * 0.45, SPARK);
      }
    } else if (phase === 'reveal') {
      dataRing(lcd, 18, angle, 16, 1 - p * 0.6);
      actor(this.to, { silhouette: true, frame: 0 });
      actor(this.to, { reveal: p, frame: 0 });
    } else {
      const jump = this.reducedMotion || this.done ? 0 : Math.round(Math.sin(p * Math.PI) * 2);
      lcd.monster(this.to, 16, PET_Y - jump, { frame });
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const r = this.reducedMotion ? 17 : 11 + p * 10;
        const x = 24 + Math.cos(a) * r;
        const y = 13 + Math.sin(a) * r * 0.5;
        effectDot(lcd, x, y, SPARK);
        if (i % 2 === 0) effectDot(lcd, x + 1, y, SPARK, 0.8);
      }
    }
  }
  tap() {
    if (this.phase === 'celebrate') this.finish();
  }
}

// ───────────── 애정 놀이: 탭하면 작은 하트가 하나씩 더 떠오른다 ─────────────
export class PlayScene extends PresentationScene {
  constructor(speciesId, opts = { reducedMotion: false }) {
    super(opts);
    this.sp = speciesId;
    this.duration = 2000;
    this.interactive = true;
    this.pets = 0;
    this.cue('pet');
  }
  get phase() {
    return this.cancelled ? 'cancelled' : this.done ? 'done'
      : this.t < 450 ? 'greet' : this.t < 1500 ? 'hearts' : 'happy';
  }
  update(dt) {
    if (this.done || !Number.isFinite(dt) || dt < 0) return;
    this.t = Math.min(this.duration, this.t + dt);
    if (this.t >= this.duration) this.finish();
  }
  draw(lcd) {
    if (this.cancelled) return;
    lcd.setDark(false);
    lcd.clear();
    const bob = this.reducedMotion ? 0 : Math.round(Math.sin(this.t / 220) * 0.7);
    lcd.monster(this.sp, 16, PET_Y - Math.max(0, bob), {
      frame: this.reducedMotion ? 0 : Math.floor(this.t / 450) % 2,
    });
    const positions = [[5, 7], [35, 5], [22, 0], [3, 14]];
    const count = Math.min(4, 1 + this.pets + Math.floor(this.t / 650));
    for (let i = 0; i < count; i++) {
      const [x, y] = positions[i];
      const rise = this.reducedMotion ? 0 : Math.min(3, Math.floor(this.t / 550));
      lcd.icon('heart', x, Math.max(0, y - rise));
    }
  }
  tap() {
    if (this.done || this.pets >= 3) return;
    this.pets++;
    this.cue(`pet${this.pets}`);
    if (!this.reducedMotion && this.opts.sound !== false) vibrate(15);
  }
}

// ───────────── 훈련 미니게임 ─────────────
// 오른쪽 게이지가 오르내린다. 높을 때(6칸 이상) 화면을 탭하면 명중.
export class TrainScene {
  constructor(speciesId, onFinish) {
    this.sp = speciesId;
    this.onFinish = onFinish;
    this.interactive = true;
    this.round = 0;
    this.hits = 0;
    this.phase = 'aim'; // aim → shot → (aim | result)
    this.t = 0;
    this.level = 0;
    this.lastHit = false;
    this.done = false;
    this.speed = 90 - Math.min(40, speciesOf(speciesId).power || 0) / 2; // ms per level
  }
  update(dt) {
    if (this.done) return;
    this.t += dt;
    if (this.phase === 'aim') {
      const cycle = Math.floor(this.t / this.speed) % 16;
      this.level = cycle < 8 ? cycle + 1 : 16 - cycle;
      if (this.t > 6000) this.fire(true); // 시간 초과는 실패로 처리한다.
    } else if (this.phase === 'shot' && this.t > 1100) {
      this.round++;
      if (this.round >= TRAIN_ROUNDS) {
        this.phase = 'result';
        this.t = 0;
        play(this.hits >= TRAIN_PASS ? 'win' : 'lose');
      } else {
        this.phase = 'aim';
        this.t = 0;
      }
    } else if (this.phase === 'result' && this.t > 2200) {
      this.finish();
    }
  }
  fire(timedOut = false) {
    if (this.done || this.phase !== 'aim') return;
    this.lastHit = !timedOut && this.level >= 6;
    if (this.lastHit) this.hits++;
    this.phase = 'shot';
    this.t = 0;
    play(this.lastHit ? 'hit' : 'no');
    vibrate(this.lastHit ? 40 : 15);
  }
  finish() {
    if (this.done) return;
    this.done = true;
    const onFinish = this.onFinish;
    this.onFinish = null;
    onFinish?.(this.hits);
  }
  cancel() {
    this.done = true;
    this.onFinish = null;
  }
  draw(lcd) {
    lcd.setDark(false);
    lcd.clear();
    if (this.phase === 'result') {
      const ok = this.hits >= TRAIN_PASS;
      lcd.monster(this.sp, 4, PET_Y - (ok && Math.floor(this.t / 250) % 2 ? 2 : 0));
      lcd.number(`${this.hits}/${TRAIN_ROUNDS}`, 26, 4);
      lcd.icon(ok ? 'heart' : 'sweat', 30, 13);
      return;
    }
    lcd.monster(this.sp, 2, PET_Y, { flip: true });
    // 벽
    const wallBroken = this.phase === 'shot' && this.lastHit && this.t > 500;
    if (!wallBroken) lcd.icon('wall', 34, LCD_H - 16);
    // 게이지 (8칸)
    for (let i = 0; i < 8; i++) {
      const y = LCD_H - 3 - i * 3;
      const filled = this.phase === 'aim' ? i < this.level : false;
      lcd.dot(44, y, true);
      if (filled) lcd.dot(45, y), lcd.dot(46, y);
      if (i === 5) lcd.dot(47, y);
    }
    // 남은 횟수
    for (let i = 0; i < TRAIN_ROUNDS - this.round; i++) lcd.dot(20 + i * 2, 0);
    if (this.phase === 'shot') {
      const x = Math.min(32, 18 + Math.floor(this.t / 30));
      if (this.t < 500) lcd.icon(this.lastHit ? 'shotBig' : 'shot', x, 12);
      else if (this.lastHit) lcd.icon('hit', 34, 10);
    }
  }
  tap() {
    if (this.done) return;
    if (this.phase === 'aim' && this.t > 150) this.fire();
    else if (this.phase === 'result' && this.t > 600) this.finish();
  }
}

// ───────────── 대전 ─────────────
// 내 몬스터는 오른쪽(왼쪽을 봄), 상대는 왼쪽(오른쪽을 봄).
export class BattleScene {
  constructor(mySpecies, oppSpecies, result, onFinish) {
    this.me = mySpecies;
    this.opp = oppSpecies;
    this.log = result.log;
    this.won = result.winner === 'A';
    this.onFinish = onFinish;
    this.interactive = true;
    this.i = -1; // -1 = 등장 연출
    this.t = 0;
    this.done = false;
    this.hp = { A: 3, B: 3 };
  }
  update(dt) {
    if (this.done) return;
    this.t += dt;
    const turnLen = 1000;
    if (this.i === -1 && this.t > 1200) {
      this.i = 0;
      this.t = 0;
    } else if (this.i >= 0 && this.i < this.log.length && this.t > turnLen) {
      const e = this.log[this.i];
      if (e.hit) this.hp[e.by === 'A' ? 'B' : 'A'] -= 1;
      this.i++;
      this.t = 0;
      if (this.i === this.log.length) play(this.won ? 'win' : 'lose');
      this._buzzed = false;
    } else if (this.i >= this.log.length && this.t > 2600) {
      this.finish();
    }
    const e = this.log[this.i];
    if (e && e.hit && !this._buzzed && this.t > 550) {
      this._buzzed = true;
      play('hit');
      vibrate(e.by === 'B' ? 60 : 25);
    }
  }
  finish() {
    if (this.done) return;
    this.done = true;
    const onFinish = this.onFinish;
    this.onFinish = null;
    onFinish?.();
  }
  cancel() {
    this.done = true;
    this.onFinish = null;
  }
  draw(lcd) {
    lcd.setDark(false);
    lcd.clear();
    const end = this.i >= this.log.length;
    const e = !end && this.i >= 0 ? this.log[this.i] : null;
    const blinkA = e && e.hit && e.by === 'B' && this.t > 550 && Math.floor(this.t / 80) % 2;
    const blinkB = e && e.hit && e.by === 'A' && this.t > 550 && Math.floor(this.t / 80) % 2;
    if (end) {
      const jump = Math.floor(this.t / 250) % 2 ? 2 : 0;
      if (this.won) {
        lcd.monster(this.me, 32, PET_Y - jump);
        lcd.monster(this.opp, 0, PET_Y, { flip: true });
        lcd.icon('sweat', 16, PET_Y);
      } else {
        lcd.monster(this.opp, 0, PET_Y - jump, { flip: true });
        lcd.monster(this.me, 32, PET_Y);
        lcd.icon('sweat', 28, PET_Y);
      }
      return;
    }
    if (!blinkB) lcd.monster(this.opp, 0, PET_Y, { flip: true });
    if (!blinkA) lcd.monster(this.me, 32, PET_Y);
    // 체력 점
    for (let k = 0; k < this.hp.B; k++) lcd.dot(1 + k * 2, 0);
    for (let k = 0; k < this.hp.A; k++) lcd.dot(LCD_W - 2 - k * 2, 0);
    if (e && this.t < 550) {
      const p = this.t / 550;
      const x = e.by === 'A' ? Math.round(28 - p * 14) : Math.round(16 + p * 12);
      lcd.icon('shot', x, 12);
    } else if (e && e.hit && this.t < 800) {
      lcd.icon('hit', e.by === 'A' ? 4 : 36, 10);
    }
  }
  tap() {
    if (this.done) return;
    if (this.i >= this.log.length) this.finish();
  }
}

// ───────────── 메시지 없이 잠깐 아이콘만 보여 주기 (치료 등) ─────────────
export class IconScene {
  constructor(speciesId, icon, ms = 1500) {
    this.sp = speciesId;
    this.iconName = icon;
    this.ms = ms;
    this.t = 0;
    this.done = false;
  }
  update(dt) {
    this.t += dt;
    if (this.t > this.ms) this.done = true;
  }
  draw(lcd) {
    lcd.setDark(false);
    lcd.clear();
    lcd.monster(this.sp, 16, PET_Y - (Math.floor(this.t / 300) % 2));
    if (Math.floor(this.t / 250) % 2) lcd.icon(this.iconName, 36, 2);
  }
  tap() {
    this.done = true;
  }
}

// LCD 화면 그리기. 논리 해상도(LCD_W x LCD_H 도트)를 정수 배율로 키워 캔버스에 그린다.
// 디지몬은 스프라이트 시트(ATLAS)에서 잘라 그리고, 시트를 못 읽으면 16×16 도트 폴백을 그린다.

import { LCD_W, LCD_H } from './config.js';
import { getSprite, parseSprite, spriteFrame } from './sprites.js';
import { ATLAS, spriteInfo } from './species.js';

export const PALETTE = {
  light: { bg: '#a7b48f', ghost: '#9aa883', on: '#1e2a1b' },
  dark: { bg: '#2c3527', ghost: '#323c2c', on: '#6f7d61' },
};

// 도트도 이미지도 없는 종에 쓰는 물음표 실루엣
const PLACEHOLDER = parseSprite([
  '................',
  '.....######.....',
  '....##....##....',
  '...##......##...',
  '...##......##...',
  '..........##....',
  '.........##.....',
  '........##......',
  '.......##.......',
  '.......##.......',
  '................',
  '.......##.......',
  '.......##.......',
  '................',
  '................',
  '................',
]);

// 모든 디지몬과 알이 한 장의 스프라이트 시트에 들어 있다 (셀 하나 = ATLAS.cell 픽셀).
let atlas = null;
function loadAtlas() {
  if (atlas) return atlas;
  const entry = { img: new Image(), ready: false, failed: false };
  atlas = entry;
  entry.done = new Promise(resolve => {
    entry.img.onload = () => {
      if (entry.ready || entry.failed) return;
      entry.ready = true;
      resolve(entry);
    };
    entry.img.onerror = () => {
      if (entry.ready || entry.failed) return;
      entry.failed = true;
      resolve(entry);
    };
  });
  // 모듈 위치를 기준으로 찾으므로 하위 경로 배포도 지원한다.
  entry.img.src = new URL(ATLAS.src, new URL('../', import.meta.url)).href;
  return entry;
}

function fallbackBits(id) {
  return spriteInfo(id) ? getSprite(id) : PLACEHOLDER;
}

/**
 * 그림을 고른다. id는 종 ID 또는 알 그림 ID(egg:<무늬>). frame(0/1)은 두 포즈를 번갈아 쓴다.
 * 돌려주는 값: { bits } (도트) 또는 { img, crop } (시트 + 두 포즈 공통 영역)
 * 두 포즈가 같은 영역을 쓰므로 포즈가 바뀌어도 크기가 변하지 않고 발이 바닥에 붙는다.
 */
export function monsterVisual(id, frame = 0) {
  const info = spriteInfo(id);
  const bits = fallbackBits(id);
  if (info && typeof Image !== 'undefined') {
    const entry = loadAtlas();
    if (entry.ready) {
      const cell = info.cells[spriteFrame(frame, info.cells.length)];
      const [left, top, right, bottom] = info.box;
      return {
        img: entry.img,
        crop: {
          x: (cell % ATLAS.cols) * ATLAS.cell + left,
          y: Math.floor(cell / ATLAS.cols) * ATLAS.cell + top,
          w: right - left,
          h: bottom - top,
        },
      };
    }
    // 로딩 중/실패 시에도 폴백을 그려 화면이 비지 않게 한다.
    if (!entry.failed) return { bits, loading: true, done: entry.done };
  }
  return { bits };
}

export class LCD {
  constructor(canvas, { w = LCD_W, h = LCD_H, scale = 8 } = {}) {
    this.canvas = canvas;
    this.w = w;
    this.h = h;
    this.scale = scale;
    canvas.width = w * scale;
    canvas.height = h * scale;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.pal = PALETTE.light;
  }

  setDark(dark) {
    this.pal = dark ? PALETTE.dark : PALETTE.light;
  }

  clear() {
    const { ctx, scale, pal } = this;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // 꺼진 도트 격자 (액정 느낌)
    ctx.fillStyle = pal.ghost;
    const g = Math.max(1, Math.floor(scale * 0.85));
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) ctx.fillRect(x * scale, y * scale, g, g);
  }

  dot(x, y, on = true) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const { ctx, scale, pal } = this;
    const g = Math.max(1, Math.floor(scale * 0.85));
    ctx.fillStyle = on ? pal.on : pal.bg;
    ctx.fillRect(x * scale, y * scale, g, g);
  }

  /** Small colored procedural particles, never a screen-wide flash. */
  effectDot(x, y, { color = '#48b9ac', alpha = 1 } = {}) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const { ctx, scale } = this;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = color;
    ctx.fillRect(x * scale, y * scale, Math.max(1, Math.floor(scale * 0.85)), Math.max(1, Math.floor(scale * 0.85)));
    ctx.restore();
  }

  /** 파싱된 비트 스프라이트를 그린다. flip = 좌우 반전, invert = 반전 색. */
  bits(sprite, x0, y0, { flip = false, invert = false } = {}) {
    const { w, h, bits } = sprite;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const on = bits[y * w + (flip ? w - 1 - x : x)] === 1;
        if (on !== invert) this.dot(x0 + x, y0 + y, true);
      }
    }
  }

  icon(name, x, y, opts) {
    this.bits(getSprite(name), x, y, opts);
  }

  /** 몬스터를 16x16 칸 안에 그린다. */
  monster(speciesId, x, y, { flip = false, frame = 0, invert = false, silhouette = false, alpha = 1, reveal = 1 } = {}) {
    const v = monsterVisual(speciesId, frame);
    // Legacy inversion remains available to callers, but evolution never uses it.
    if (invert) return this.bits(v.bits || fallbackBits(speciesId), x, y, { flip, invert });
    alpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    reveal = Number.isFinite(reveal) ? Math.max(0, Math.min(1, reveal)) : 1;
    if (alpha === 0 || reveal === 0) return;
    const { ctx, scale } = this;
    const size = 16 * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (reveal < 1 && ctx.clip) {
      ctx.beginPath();
      ctx.rect(x * scale, (y + 16 * (1 - reveal)) * scale, size, size * reveal);
      ctx.clip();
    }
    if (v.bits || (silhouette && !('filter' in ctx))) {
      const sprite = v.bits || fallbackBits(speciesId);
      for (let row = 0; row < sprite.h; row++) {
        if (row < sprite.h * (1 - reveal)) continue;
        for (let col = 0; col < sprite.w; col++) {
          if (sprite.bits[row * sprite.w + (flip ? sprite.w - 1 - col : col)] === 1) this.dot(x + col, y + row);
        }
      }
      ctx.restore();
      return;
    }
    if (!v.img) { ctx.restore(); return; }
    if (silhouette) ctx.filter = 'brightness(0)';
    if (flip) {
      ctx.translate((x + 16) * scale, y * scale);
      ctx.scale(-1, 1);
    }
    const originX = flip ? 0 : x * scale;
    const originY = flip ? 0 : y * scale;
    const { x: sx, y: sy, w, h } = v.crop;
    const ratio = size / Math.max(w, h);
    const dw = w * ratio;
    const dh = h * ratio;
    // Center horizontally, align the shared crop's bottom to the logical slot.
    ctx.drawImage(v.img, sx, sy, w, h, originX + (size - dw) / 2, originY + size - dh, dw, dh);
    ctx.restore();
  }

  rect(x, y, w, h, fill = false) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) if (fill || j === 0 || i === 0 || j === h - 1 || i === w - 1) this.dot(x + i, y + j);
  }

  /** 아주 작은 3x5 숫자 */
  number(n, x, y) {
    const s = String(n);
    for (let i = 0; i < s.length; i++) {
      const rows = DIGITS[s[i]];
      if (!rows) continue;
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < 3; rx++) if (row[rx] === '#') this.dot(x + i * 4 + rx, y + ry);
      });
    }
  }
}

const DIGITS = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '###', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '..#', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '-': ['...', '...', '###', '...', '...'],
};

const thumbRequests = new WeakMap();

/** 도감 썸네일처럼 작은 별도 캔버스에 몬스터 하나를 그린다. */
export function drawThumb(canvas, speciesId, { silhouette = false, scale = 4 } = {}) {
  const request = {};
  thumbRequests.set(canvas, request);
  const lcd = new LCD(canvas, { w: 18, h: 18, scale });
  lcd.clear();
  if (silhouette) {
    lcd.bits(PLACEHOLDER, 1, 1);
  } else {
    lcd.monster(speciesId, 1, 1);
    const v = monsterVisual(speciesId);
    if (v.loading) v.done.then(() => {
      if (thumbRequests.get(canvas) === request) drawThumb(canvas, speciesId, { scale });
    });
  }
}

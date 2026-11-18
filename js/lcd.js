// LCD 화면 그리기. 논리 해상도(LCD_W x LCD_H 도트)를 정수 배율로 키워 캔버스에 그린다.
// 몬스터는 sprites.js의 도트를 그리거나, 종에 img가 있으면 그 이미지를 그린다.

import { LCD_W, LCD_H } from './config.js';
import { getSprite, MONSTER_SPRITES, parseSprite, spriteFrame } from './sprites.js';
import { SPECIES } from './species.js';

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

const imageCache = new Map();
// Alpha-channel union of BOTH original GIF poses, measured with Pillow.
// [left, top, right, bottom]; originals remain byte-for-byte untouched.
// One shared crop prevents pose-by-pose rescaling and keeps feet on the ground.
const ORIGINAL_BOUNDS = {
  egg: [6, 3, 30, 32],
  ttol: [21, 49, 51, 68],
  ttolttol: [21, 45, 50, 68],
  piko: [18, 33, 53, 68],
  monggle: [18, 28, 52, 68],
  volt: [5, 26, 67, 68],
  kara: [5, 20, 67, 66],
  mungchi: [8, 25, 64, 68],
  jellion: [4, 15, 67, 68],
  mush: [8, 20, 64, 68],
  noise: [8, 20, 64, 68],
  raiga: [7, 20, 64, 68],
  grove: [4, 20, 67, 68],
  buglord: [9, 14, 64, 68],
};

function dimensions(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  return Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0 ? { w, h } : null;
}

function imageBounds(src, img) {
  const size = dimensions(img);
  if (!size) return null; // Mocked Image / undecoded image: retain the old draw path.
  for (const [id, box] of Object.entries(ORIGINAL_BOUNDS)) {
    const expectedSize = id === 'egg' ? 36 : 72;
    if (SPECIES[id].img.includes(src) && size.w === expectedSize && size.h === expectedSize) {
      return box.map(value => value / expectedSize);
    }
  }
  // Replacement assets can be scanned once on load. Never mutate img.crossOrigin:
  // existing/read-only Images and tainted canvases must still render normally.
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size.w, size.h)
      : globalThis.document?.createElement?.('canvas');
    if (!canvas) return null;
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx?.getImageData) return null;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, size.w, size.h);
    let left = size.w, top = size.h, right = 0, bottom = 0;
    for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) {
      if (data[(y * size.w + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
    return right > left && bottom > top ? [left / size.w, top / size.h, right / size.w, bottom / size.h] : null;
  } catch {
    return null; // SecurityError, failed decoding, or unavailable canvas.
  }
}

function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const entry = { img: new Image(), ready: false, failed: false, bounds: null };
  imageCache.set(src, entry);
  entry.done = new Promise(resolve => {
    entry.img.onload = () => {
      if (entry.ready || entry.failed) return;
      entry.bounds = imageBounds(src, entry.img);
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
  entry.img.src = new URL(src, new URL('../', import.meta.url)).href;
  return entry;
}

function sharedCrop(entries, selected) {
  const size = dimensions(selected.img);
  if (!size) return null;
  const boxes = entries.filter(entry => entry.ready).map(entry => entry.bounds || [0, 0, 1, 1]);
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box[0]));
  const top = Math.min(...boxes.map(box => box[1]));
  const right = Math.max(...boxes.map(box => box[2]));
  const bottom = Math.max(...boxes.map(box => box[3]));
  return { x: left * size.w, y: top * size.h, w: (right - left) * size.w, h: (bottom - top) * size.h };
}

/**
 * 종의 그림을 고른다. frame(0/1)은 이미지가 2장일 때 번갈아 쓴다.
 * 돌려주는 값: { bits } (도트) 또는 { img, crop } (이미지 + 공통 콘텐츠 경계)
 */
export function monsterVisual(speciesId, frame = 0) {
  const sp = SPECIES[speciesId];
  const bits = MONSTER_SPRITES[speciesId] ? getSprite(speciesId, frame) : PLACEHOLDER;
  if (sp && Array.isArray(sp.img) && sp.img.length && typeof Image !== 'undefined') {
    const entries = sp.img.map(loadImage);
    const e = entries[spriteFrame(frame, entries.length)];
    if (e.ready) return { img: e.img, crop: sharedCrop(entries, e) };
    // 로딩 중/실패 시에도 디지몬 폴백을 그려 화면이 비지 않게 한다.
    if (!e.failed) return { bits, loading: true, done: e.done };
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
    if (invert) return this.bits(v.bits || (MONSTER_SPRITES[speciesId] ? getSprite(speciesId, frame) : PLACEHOLDER), x, y, { flip, invert });
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
      const sprite = v.bits || getSprite(speciesId, frame);
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
    if (v.crop) {
      const { x: sx, y: sy, w, h } = v.crop;
      const ratio = size / Math.max(w, h);
      const dw = w * ratio;
      const dh = h * ratio;
      // Center horizontally, align the shared crop's bottom to the logical slot.
      ctx.drawImage(v.img, sx, sy, w, h, originX + (size - dw) / 2, originY + size - dh, dw, dh);
    } else if (flip) {
      ctx.drawImage(v.img, 0, 0, size, size);
    } else {
      ctx.drawImage(v.img, x * scale, y * scale, size, size);
    }
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

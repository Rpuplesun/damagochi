// 친구 대전 코드. 서버 없이 카톡 등으로 코드를 주고받아 대전한다.
// 형식: DOT-<base64url(JSON)>-<체크섬 4자리>

import { hashString } from './rng.js';
import { isKnownSpecies } from './game.js';
import { battlePower } from './battle.js';
import { speciesOf } from './species.js';

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64) {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm + '==='.slice((norm.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function checksum(body) {
  return (hashString('dotmon:' + body) % 1679616).toString(36).padStart(4, '0');
}

export function encodeFriendCode(pet) {
  const data = {
    v: 1,
    s: pet.species,
    n: pet.name || speciesOf(pet.species).name,
    p: battlePower(pet),
    b: pet.battles,
    w: pet.wins,
    id: pet.id,
  };
  const body = toBase64Url(JSON.stringify(data));
  return `DOT-${body}-${checksum(body)}`;
}

/** 코드를 해석한다. 잘못된 코드면 null. */
export function decodeFriendCode(code) {
  const m = String(code || '').trim().match(/^DOT-([A-Za-z0-9_-]+)-([0-9a-z]{4})$/);
  if (!m) return null;
  const [, body, sum] = m;
  if (checksum(body) !== sum) return null;
  try {
    const d = JSON.parse(fromBase64Url(body));
    if (d.v !== 1 || !isKnownSpecies(d.s)) return null;
    const power = Number(d.p);
    if (!Number.isFinite(power) || power < 1 || power > 300) return null;
    return {
      species: d.s,
      name: String(d.n || '').slice(0, 8),
      power,
      battles: Number(d.b) || 0,
      wins: Number(d.w) || 0,
      id: String(d.id || ''),
    };
  } catch {
    return null;
  }
}

// 기기 이동용 세이브 백업
export function encodeSave(state) {
  return 'DOTSAVE-' + toBase64Url(JSON.stringify(state));
}

export function decodeSave(text) {
  const m = String(text || '').trim().match(/^DOTSAVE-([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const s = JSON.parse(fromBase64Url(m[1]));
    if (!s || typeof s !== 'object' || !s.pet || !s.settings) return null;
    return s;
  } catch {
    return null;
  }
}

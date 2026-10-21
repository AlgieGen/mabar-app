import { escapeHtml } from './util.js';

// Palet 16 warna ala konsol jadul. Avatar disimpan sebagai 64 karakter hex (8×8):
// '0' = transparan, '1'..'f' = indeks warna di bawah.
export const PALETTE = [
  null, '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7',
  '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#ff77a8', '#ffccaa',
];

// Aksesori: lapisan 8×8 yang digambar di atas avatar (baris yang tidak disebut = kosong)
const ACCESSORIES = {
  'acc:cap': { 0: '00dddd00', 1: '0ddddddd' },
  'acc:shades': { 3: '11111111', 4: '01100110' },
  'acc:headphones': { 0: '06666660', 1: '60000006', 2: '60000006', 3: 'd000000d', 4: 'd000000d' },
  'acc:halo': { 0: '0bbbbbb0' },
  'acc:horns': { 0: '90000009', 1: '99000099' },
  'acc:crown': { 0: 'b00bb00b', 1: 'bbbbbbbb' },
};

export function randomAvatar() {
  const colors = ['9', 'a', 'b', 'c', 'd', 'e', 'f', '4', '3'];
  const body = colors[Math.floor(Math.random() * colors.length)];
  const grid = Array(64).fill('0');
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 4; c++) {
      if (Math.random() < (r === 0 || r === 7 ? 0.35 : 0.55)) grid[r * 8 + c] = grid[r * 8 + 7 - c] = body;
    }
  }
  grid[3 * 8 + 2] = grid[3 * 8 + 5] = '1';
  return grid.join('');
}

// Gabungkan avatar dan aksesori menjadi SVG pixel yang tajam di ukuran berapa pun
export function avatarSvg(avatar, acc) {
  const cells = [...(avatar || '0'.repeat(64))];
  const layer = ACCESSORIES[acc];
  if (layer) {
    for (const [row, line] of Object.entries(layer)) {
      [...line].forEach((ch, col) => { if (ch !== '0') cells[row * 8 + col] = ch; });
    }
  }
  let rects = '';
  cells.forEach((ch, i) => {
    const color = PALETTE[parseInt(ch, 16)];
    if (color) rects += `<rect x="${i % 8}" y="${Math.floor(i / 8)}" width="1.02" height="1.02" fill="${color}"/>`;
  });
  return `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

// Avatar lengkap dengan bingkai dan (opsional) label level
export function avatarHtml(profile, { size = 30, level = true, fallback = '?' } = {}) {
  if (!profile) return `<span class="av av-empty" style="--av:${size}px">${escapeHtml(fallback[0]?.toUpperCase() || '?')}</span>`;
  const border = (profile.border || 'border:none').split(':')[1];
  return `<span class="av b-${border}" style="--av:${size}px">${avatarSvg(profile.avatar, profile.acc)}${level ? `<span class="av-lv">${profile.level}</span>` : ''}</span>`;
}

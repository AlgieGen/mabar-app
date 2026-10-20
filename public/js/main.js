import { initVoice } from './voice.js';
import { initPlanning } from './planning.js';
import { initPhoto } from './photo.js';
import { initGame } from './game.js';
import { initTebak } from './tebak.js';
import { initWerewolf } from './werewolf.js';
import { escapeHtml } from './util.js';

const $ = (id) => document.getElementById(id);
// Kosong = server di alamat yang sama. Di Vercel diisi alamat server Render (lihat config.js).
const socket = io(window.MABAR_SERVER_URL || undefined);

// Konteks bersama yang dipakai semua modul
const ctx = {
  socket,
  me: null,
  members: [],
  memberListeners: [],
  memberName(id) { return this.members.find((m) => m.id === id)?.name ?? '—'; },
  toast,
};

const voice = initVoice(ctx);
const planning = initPlanning(ctx);
const photo = initPhoto(ctx);
const game = initGame(ctx);
const tebak = initTebak(ctx);
const werewolf = initWerewolf(ctx);

// ---------- Utilitas ----------
let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

const COLORS = ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#9a82ff', '#ff8fab', '#f77f00', '#06d6a0'];
function colorFor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

// ---------- Lobby ----------
const params = new URLSearchParams(location.search);
try { $('userName').value = localStorage.getItem('mabar:name') || ''; } catch {}
if (params.get('room')) $('joinCode').value = params.get('room').toUpperCase();

function getName() {
  const name = $('userName').value.trim();
  if (!name) { $('lobbyError').textContent = 'Isi nama kamu dulu ya.'; $('userName').focus(); return null; }
  try { localStorage.setItem('mabar:name', name); } catch {}
  return name;
}

let session = null; // { code, userName } room yang sedang dimasuki

function joinRoom(code, userName) {
  socket.emit('room:join', { code, userName }, (res) => {
    if (res.error) {
      $('lobbyError').textContent = res.error;
      if (session) { session = null; $('room').classList.add('hidden'); $('lobby').classList.remove('hidden'); }
      return;
    }
    session = { code: res.room.code, userName };
    enterRoom(res);
  });
}

$('createBtn').onclick = () => {
  const name = getName(); if (!name) return;
  socket.emit('room:create', { roomName: $('roomName').value }, ({ code }) => joinRoom(code, name));
};
$('joinBtn').onclick = () => {
  const name = getName(); if (!name) return;
  const code = $('joinCode').value.trim().toUpperCase();
  if (!code) { $('lobbyError').textContent = 'Masukkan kode room.'; return; }
  joinRoom(code, name);
};
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

function enterRoom({ me, room }) {
  ctx.me = me;
  $('lobby').classList.add('hidden');
  $('room').classList.remove('hidden');
  $('chatFab').classList.remove('hidden');
  $('roomTitle').textContent = room.name;
  $('roomCode').textContent = room.code;
  document.title = `${room.name} · MabarRoom`;
  history.replaceState(null, '', `?room=${room.code}`);

  setMembers(room.members);
  $('chatLog').innerHTML = '';
  room.chat.forEach(addChat);
  planning.load(room.plan);
  photo.load(room.photo);
  game.load(room.game);
  tebak.load(room.tebak);
  werewolf.reset();
}

$('copyLinkBtn').onclick = async () => {
  const link = `${location.origin}/?room=${$('roomCode').textContent}`;
  try { await navigator.clipboard.writeText(link); toast('Link undangan disalin!'); }
  catch { prompt('Salin link ini:', link); }
};
$('leaveRoomBtn').onclick = () => { voice.leave(); location.href = '/'; };

// ---------- Tabs ----------
function openTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-body').forEach((b) => b.classList.toggle('hidden', b.id !== `tab-${name}`));
  if (name === 'photo') photo.redraw();
}
ctx.openTab = openTab;
document.querySelectorAll('.tab').forEach((btn) => { btn.onclick = () => openTab(btn.dataset.tab); });

// ---------- Anggota ----------
function setMembers(list) {
  ctx.members = list;
  $('memberList').innerHTML = list.map((m) => `
    <li data-id="${m.id}" class="${m.id === ctx.me ? 'me' : ''}">
      <span class="avatar" style="background:${colorFor(m.id)}">${escapeHtml(m.name[0].toUpperCase())}</span>
      <span class="m-name">${escapeHtml(m.name)}${m.id === ctx.me ? ' (kamu)' : ''}</span>
      <span class="m-status"></span>
      <span class="m-icons">${m.inVoice ? (m.muted ? '🔇' : '🎙️') : ''}</span>
    </li>`).join('');
  ctx.memberListeners.forEach((fn) => fn(list));
}
socket.on('members', setMembers);

// ---------- Chat ----------
function addChat(msg) {
  const log = $('chatLog');
  const el = document.createElement('div');
  if (msg.system) {
    el.className = 'msg system';
    el.textContent = msg.text;
  } else {
    el.className = 'msg' + (msg.from === ctx.me ? ' mine' : '');
    const time = new Date(msg.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<div class="msg-name">${escapeHtml(msg.name)}<span class="msg-time">${time}</span></div>${escapeHtml(msg.text)}`;
  }
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.appendChild(el);
  if (atBottom || msg.from === ctx.me) log.scrollTop = log.scrollHeight;
}
socket.on('chat:msg', addChat);

// Di layar HP, chat tampil sebagai panel yang dibuka lewat tombol mengambang
const mobile = window.matchMedia('(max-width: 760px)');
let unread = 0;
function setChatOpen(open) {
  $('chatPanel').classList.toggle('open', open);
  if (open) {
    unread = 0;
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
  }
  $('chatBadge').textContent = unread > 9 ? '9+' : unread;
  $('chatBadge').classList.toggle('hidden', unread === 0);
}
$('chatFab').onclick = () => setChatOpen(!$('chatPanel').classList.contains('open'));
$('chatCloseBtn').onclick = () => setChatOpen(false);
socket.on('chat:msg', (msg) => {
  if (!mobile.matches || $('chatPanel').classList.contains('open') || msg.from === ctx.me) return;
  unread++;
  setChatOpen(false);
});
$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (text) socket.emit('chat:send', text);
  $('chatInput').value = '';
};

// Status koneksi di lobby. Server gratis yang sedang tidur butuh waktu untuk bangun.
const conn = $('connStatus');
const slowTimer = setTimeout(() => {
  if (!socket.connected) conn.textContent = '⏳ Server sedang dibangunkan, biasanya butuh 30–60 detik...';
}, 4000);
socket.on('connect', () => { clearTimeout(slowTimer); conn.textContent = '🟢 Terhubung ke server'; conn.classList.add('ok'); });
socket.on('disconnect', () => { conn.textContent = '🔴 Terputus, mencoba menyambung lagi...'; conn.classList.remove('ok'); });

// Koneksi putus (mis. server restart / sinyal hilang): Socket.IO menyambung ulang sendiri,
// lalu kita masuk lagi ke room yang sama.
socket.on('disconnect', () => {
  if (!session) return;
  voice.leave();
  toast('Koneksi terputus, mencoba menyambung lagi...');
});
socket.on('connect', () => {
  if (!session) return;
  joinRoom(session.code, session.userName);
  toast('Tersambung kembali ✅');
});

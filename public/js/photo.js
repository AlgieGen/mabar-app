// Edit foto bareng: satu foto dasar + lapisan coretan/teks + filter, semua tersinkron.
// Koordinat & ukuran disimpan relatif (0..1 terhadap lebar/tinggi) agar sama di layar mana pun.

const MAX_SIZE = 1600;
const BLANK_W = 1280, BLANK_H = 720;

export function initPhoto(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  const base = $('baseCanvas'), draw = $('drawCanvas');
  const bctx = base.getContext('2d'), dctx = draw.getContext('2d');

  let state = { image: null, strokes: [], filters: {} };
  let img = null;
  let tool = 'pen';
  let current = null;

  // ---------- Render ----------
  function filterCss(f) {
    return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) grayscale(${f.grayscale}%) sepia(${f.sepia}%) hue-rotate(${f.hue}deg) blur(${f.blur}px)`;
  }

  function drawBase() {
    const w = img ? img.naturalWidth : BLANK_W;
    const h = img ? img.naturalHeight : BLANK_H;
    for (const c of [base, draw]) { c.width = w; c.height = h; }
    if (img) bctx.drawImage(img, 0, 0);
    else { bctx.fillStyle = '#ffffff'; bctx.fillRect(0, 0, w, h); }
    base.style.filter = filterCss(state.filters);
  }

  function drawStroke(s, c = dctx) {
    const W = draw.width, H = draw.height;
    c.save();
    if (s.type === 'text') {
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = s.color;
      c.font = `bold ${s.size * W * 4}px system-ui, sans-serif`;
      c.textBaseline = 'middle';
      c.lineWidth = Math.max(2, s.size * W * 0.4);
      c.strokeStyle = 'rgba(0,0,0,.6)';
      c.strokeText(s.text, s.x * W, s.y * H);
      c.fillText(s.text, s.x * W, s.y * H);
    } else {
      c.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : 'source-over';
      c.strokeStyle = s.color;
      c.fillStyle = s.color;
      c.lineWidth = s.size * W;
      c.lineCap = c.lineJoin = 'round';
      const pts = s.points;
      if (pts.length === 1) {
        c.beginPath();
        c.arc(pts[0][0] * W, pts[0][1] * H, (s.size * W) / 2, 0, Math.PI * 2);
        c.fill();
      } else {
        c.beginPath();
        c.moveTo(pts[0][0] * W, pts[0][1] * H);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0] * W, pts[i][1] * H);
        c.stroke();
      }
    }
    c.restore();
  }

  function redrawStrokes() {
    dctx.clearRect(0, 0, draw.width, draw.height);
    state.strokes.forEach((s) => drawStroke(s));
  }

  function redraw() { drawBase(); redrawStrokes(); }

  function syncFilterInputs() {
    document.querySelectorAll('#filters input[data-filter]').forEach((inp) => {
      inp.value = state.filters[inp.dataset.filter];
    });
    base.style.filter = filterCss(state.filters);
  }

  function load(photo) {
    state = photo;
    syncFilterInputs();
    if (photo.image) {
      const next = new Image();
      next.onload = () => { img = next; redraw(); };
      next.src = photo.image;
    } else {
      img = null;
      redraw();
    }
  }

  // ---------- Input menggambar ----------
  function pos(e) {
    const r = draw.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  }
  const size = () => Number($('penSize').value) / 1000;

  draw.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e);
    if (tool === 'text') {
      const text = prompt('Tulis teks:');
      if (!text) return;
      const s = { type: 'text', x, y, text: text.slice(0, 100), color: $('penColor').value, size: size() * 1.5 + 0.004 };
      state.strokes.push(s);
      drawStroke(s);
      socket.emit('photo:stroke', s);
      return;
    }
    draw.setPointerCapture(e.pointerId);
    current = { type: 'pen', mode: tool === 'eraser' ? 'erase' : 'draw', color: $('penColor').value, size: size() * (tool === 'eraser' ? 3 : 1), points: [[x, y]] };
    drawStroke(current);
  });

  draw.addEventListener('pointermove', (e) => {
    if (!current) return;
    current.points.push(pos(e));
    // Gambar ulang hanya segmen terakhir agar ringan
    const seg = { ...current, points: current.points.slice(-2) };
    drawStroke(seg);
    socket.emit('photo:seg', seg);
  });

  const finish = () => {
    if (!current) return;
    // Bulatkan koordinat supaya data yang dikirim lebih kecil
    current.points = current.points.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
    state.strokes.push(current);
    socket.emit('photo:stroke', current);
    current = null;
  };
  draw.addEventListener('pointerup', finish);
  draw.addEventListener('pointercancel', finish);

  // ---------- Toolbar ----------
  document.querySelectorAll('.tool').forEach((btn) => {
    btn.onclick = () => {
      tool = btn.dataset.tool;
      document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b === btn));
      draw.style.cursor = tool === 'text' ? 'text' : 'crosshair';
    };
  });

  $('photoInput').onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const im = new Image();
      im.onload = () => {
        // Perkecil foto besar sebelum dikirim ke teman
        const scale = Math.min(1, MAX_SIZE / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * scale);
        c.height = Math.round(im.height * scale);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        socket.emit('photo:image', c.toDataURL('image/jpeg', 0.85));
      };
      im.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  $('undoBtn').onclick = () => socket.emit('photo:undo');
  $('clearBtn').onclick = () => { if (confirm('Hapus semua coretan untuk semua orang?')) socket.emit('photo:clear'); };

  $('downloadBtn').onclick = () => {
    const out = document.createElement('canvas');
    out.width = base.width; out.height = base.height;
    const o = out.getContext('2d');
    o.filter = filterCss(state.filters);
    o.drawImage(base, 0, 0);
    o.filter = 'none';
    o.drawImage(draw, 0, 0);
    const a = document.createElement('a');
    a.download = `mabar-foto-${Date.now()}.png`;
    a.href = out.toDataURL('image/png');
    a.click();
  };

  let filterTimer;
  document.querySelectorAll('#filters input[data-filter]').forEach((inp) => {
    inp.addEventListener('input', () => {
      state.filters[inp.dataset.filter] = Number(inp.value);
      base.style.filter = filterCss(state.filters);
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => socket.emit('photo:filters', state.filters), 60);
    });
  });
  $('resetFiltersBtn').onclick = () => {
    state.filters = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, hue: 0, blur: 0 };
    syncFilterInputs();
    socket.emit('photo:filters', state.filters);
  };

  // ---------- Event dari server ----------
  socket.on('photo:state', load);
  socket.on('photo:seg', (seg) => drawStroke(seg));
  socket.on('photo:stroke', (s) => { state.strokes.push(s); drawStroke(s); });
  socket.on('photo:strokes', (strokes) => { state.strokes = strokes; redrawStrokes(); });
  socket.on('photo:filters', (f) => { state.filters = f; syncFilterInputs(); });

  return { load, redraw };
}

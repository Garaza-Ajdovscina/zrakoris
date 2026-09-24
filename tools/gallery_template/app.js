// Zrakoris gallery: search + grid + interactive stroke-timeline replay.
// Pure static JS, no build step, no dependencies — fetches data/manifest.json
// and each session's session.json (both same-origin, so no CORS issues once
// served over http/https, e.g. GitHub Pages).

const el = (id) => document.getElementById(id);

const grid = el("grid");
const searchInput = el("search");
const countEl = el("count");
const statusEl = el("status");

const modal = el("modal");
const modalName = el("modal-name");
const modalDate = el("modal-date");
const canvas = el("replay-canvas");
const ctx = canvas.getContext("2d");
const btnPlay = el("btn-play");
const btnPrev = el("btn-prev");
const btnNext = el("btn-next");
const scrubber = el("scrubber");
const moveCounter = el("move-counter");
const dlGif = el("dl-gif");
const dlPng = el("dl-png");
const modalClose = el("modal-close");

let sessions = [];

function normalize(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function fmtDate(session) {
  if (!session.started_at) return session.date;
  const d = new Date(session.started_at);
  if (Number.isNaN(d.getTime())) return session.date;
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function displayName(session) {
  return session.name && session.name.trim() ? session.name : "(brez imena)";
}

function renderGrid(list) {
  grid.innerHTML = "";
  if (!list.length) {
    statusEl.hidden = false;
    statusEl.textContent = "Ni najdenih risb.";
    countEl.textContent = "";
    return;
  }
  statusEl.hidden = true;
  countEl.textContent = `${list.length} / ${sessions.length}`;

  const frag = document.createDocumentFragment();
  for (const s of list) {
    const card = document.createElement("button");
    card.className = "card";
    card.type = "button";
    card.setAttribute("aria-label", `Odpri risbo: ${displayName(s)}`);

    const img = document.createElement("img");
    img.src = s.gif;
    img.loading = "lazy";
    img.alt = displayName(s);
    card.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.innerHTML = `
      <div class="card-name">${escapeHtml(displayName(s))}</div>
      <div class="card-date">${escapeHtml(fmtDate(s))}</div>
    `;
    card.appendChild(meta);

    card.addEventListener("click", () => openModal(s));
    frag.appendChild(card);
  }
  grid.appendChild(frag);
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function applyFilter() {
  const q = normalize(searchInput.value);
  if (!q) {
    renderGrid(sessions);
    return;
  }
  const filtered = sessions.filter((s) => {
    const hay = normalize(s.name) || normalize(s.session_id);
    return hay.includes(q);
  });
  renderGrid(filtered);
}

searchInput.addEventListener("input", applyFilter);

// ---------------------------------------------------------------- replay

function flattenTimeline(strokes) {
  const segs = [];
  const strokeEndClock = [];
  let clock = 0;
  for (const s of strokes) {
    const pts = s.points || [];
    const color = s.color, width = s.width;
    if (pts.length === 0) {
      strokeEndClock.push(clock);
      continue;
    }
    const base = clock;
    if (pts.length === 1) {
      const p = pts[0];
      segs.push({ t: base, p0: [p[0], p[1]], p1: [p[0], p[1]], color, width });
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      segs.push({ t: base + b[2], p0: [a[0], a[1]], p1: [b[0], b[1]], color, width });
    }
    clock = base + pts[pts.length - 1][2] + 0.15;
    strokeEndClock.push(clock);
  }
  const total = segs.length ? segs[segs.length - 1].t : 0;
  return { segs, strokeEndClock, total };
}

function moveIndexForTime(t, strokeEndClock) {
  let idx = 0;
  for (const end of strokeEndClock) {
    if (t >= end - 1e-6) idx++;
    else break;
  }
  return idx;
}

const replay = {
  segs: [], strokeEndClock: [], total: 0,
  cw: 1920, ch: 1080, bg: "#ffffff", scale: 1,
  playT: 0, playing: false, rafId: null, lastTs: 0,
};

function setupCanvasSize() {
  const displayWidth = canvas.clientWidth || canvas.parentElement.clientWidth;
  const displayHeight = Math.round(displayWidth * (replay.ch / replay.cw));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(displayWidth * dpr);
  canvas.height = Math.round(displayHeight * dpr);
  canvas.style.height = `${displayHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  replay.scale = displayWidth / replay.cw;
}

function drawAt(t) {
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.fillStyle = replay.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const seg of replay.segs) {
    if (seg.t > t) break;
    const lw = Math.max(1, Math.round(seg.width * replay.scale));
    ctx.strokeStyle = seg.color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(seg.p0[0] * replay.scale, seg.p0[1] * replay.scale);
    ctx.lineTo(seg.p1[0] * replay.scale, seg.p1[1] * replay.scale);
    ctx.stroke();
  }
}

function updateControls() {
  const idx = moveIndexForTime(replay.playT, replay.strokeEndClock);
  moveCounter.textContent = `${idx} / ${replay.strokeEndClock.length}`;
  const pct = replay.total > 0 ? (replay.playT / replay.total) * 1000 : 1000;
  scrubber.value = String(Math.round(pct));
  btnPlay.textContent = replay.playing ? "⏸" : "▶";
  btnPlay.setAttribute("aria-label", replay.playing ? "Ustavi" : "Predvajaj");
}

function render() {
  drawAt(replay.playT);
  updateControls();
}

function stopPlaying() {
  replay.playing = false;
  if (replay.rafId) cancelAnimationFrame(replay.rafId);
  replay.rafId = null;
}

function tick(ts) {
  if (!replay.playing) return;
  const dt = (ts - replay.lastTs) / 1000;
  replay.lastTs = ts;
  replay.playT = Math.min(replay.total, replay.playT + dt);
  render();
  if (replay.playT >= replay.total) {
    stopPlaying();
    updateControls();
    return;
  }
  replay.rafId = requestAnimationFrame(tick);
}

function togglePlay() {
  if (replay.playing) {
    stopPlaying();
    updateControls();
    return;
  }
  if (replay.playT >= replay.total) replay.playT = 0;
  replay.playing = true;
  replay.lastTs = performance.now();
  replay.rafId = requestAnimationFrame(tick);
}

function stepMove(dir) {
  stopPlaying();
  const idx = moveIndexForTime(replay.playT, replay.strokeEndClock);
  const targetIdx = Math.min(Math.max(idx + dir, 0), replay.strokeEndClock.length);
  replay.playT = targetIdx === 0 ? 0 : replay.strokeEndClock[targetIdx - 1];
  render();
}

btnPlay.addEventListener("click", togglePlay);
btnPrev.addEventListener("click", () => stepMove(-1));
btnNext.addEventListener("click", () => stepMove(1));

scrubber.addEventListener("input", () => {
  stopPlaying();
  const pct = Number(scrubber.value) / 1000;
  replay.playT = pct * replay.total;
  render();
});

window.addEventListener("resize", () => {
  if (modal.hidden) return;
  setupCanvasSize();
  render();
});

async function openModal(session) {
  modalName.textContent = displayName(session);
  modalDate.textContent = fmtDate(session);
  dlGif.href = session.gif;
  dlGif.download = `${session.session_id}.gif`;
  if (session.png) {
    dlPng.href = session.png;
    dlPng.download = `${session.session_id}.png`;
    dlPng.hidden = false;
  } else {
    dlPng.hidden = true;
  }

  modal.hidden = false;
  document.body.style.overflow = "hidden";

  stopPlaying();
  replay.segs = [];
  replay.strokeEndClock = [];
  replay.total = 0;
  replay.playT = 0;
  replay.cw = session.canvas?.w || 1920;
  replay.ch = session.canvas?.h || 1080;
  replay.bg = session.canvas?.background || "#ffffff";
  setupCanvasSize();
  render();

  try {
    const res = await fetch(session.session);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const { segs, strokeEndClock, total } = flattenTimeline(data.strokes || []);
    replay.segs = segs;
    replay.strokeEndClock = strokeEndClock;
    replay.total = total;
    replay.playT = total; // start fully drawn, matching the thumbnail's end state
    render();
  } catch (err) {
    console.error("failed to load session timeline", err);
  }
}

function closeModal() {
  stopPlaying();
  modal.hidden = true;
  document.body.style.overflow = "";
}

modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});

// ---------------------------------------------------------------- boot

async function boot() {
  statusEl.hidden = false;
  statusEl.textContent = "Nalagam…";
  try {
    const res = await fetch("data/manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    sessions = manifest.sessions || [];
    renderGrid(sessions);
  } catch (err) {
    console.error(err);
    statusEl.hidden = false;
    statusEl.innerHTML =
      "Ni mogoče naložiti podatkov.<br>" +
      "Če to stran odpiraš neposredno kot datoteko, zaženi lokalni strežnik, npr.<br>" +
      "<code>python3 -m http.server</code> v mapi galerije.";
  }
}

boot();

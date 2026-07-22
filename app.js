/* Decks — flashcards gamifiées
   Statique, hors-ligne, données locales (localStorage). */
"use strict";

/* ================= Utilitaires ================= */
const $ = (s) => document.querySelector(s);
const today = () => new Date().toISOString().slice(0, 10);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/* Nettoyage léger du pseudo-LaTeX présent dans certains decks */
function pretty(s) {
  return s
    .replace(/\$\\?([A-Za-z]+)_\{?(\w+)\}?\$/g, (_, v, sub) => v + toSub(sub))
    .replace(/\$([A-Za-z])_(\w)\$/g, (_, v, sub) => v + toSub(sub))
    .replace(/\$\\sigma\$/g, "σ").replace(/\\sigma/g, "σ")
    .replace(/\$(\d+)\\?%\$/g, "$1 %")
    .replace(/\$/g, "").replace(/\\%/g, "%").replace(/\\/g, "")
    .trim();
}
function toSub(t) { const m = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", n: "ₙ", i: "ᵢ" }; return t.split("").map((c) => m[c] || c).join(""); }

/* Analyseur CSV (RFC 4180) */
function parseCSV(text) {
  const rows = []; let row = [], field = "", inQ = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}
function rowsToCards(rows) {
  const cards = [];
  for (const r of rows) {
    if (r.length < 2) continue;
    const q = r[0].trim(), a = r.slice(1).join(", ").trim();
    if (!q || !a) continue;
    if (["question", "recto", "front", "q"].includes(q.toLowerCase())) continue;
    cards.push({ id: hash(q), q: pretty(q), a: pretty(a) });
  }
  return cards;
}

/* ================= État persistant ================= */
const KEY = "decks-app-v1";
const state = load();
function load() {
  try {
    return Object.assign(
      { xp: 0, streak: { last: null, count: 0 }, decks: {}, custom: [], activity: {}, badges: {}, goal: 80, sound: true },
      JSON.parse(localStorage.getItem(KEY) || "{}")
    );
  } catch { return { xp: 0, streak: { last: null, count: 0 }, decks: {}, custom: [], activity: {}, badges: {}, goal: 80, sound: true }; }
}
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const deckState = (id) => (state.decks[id] ||= { cards: {}, best: {} });
const cardState = (dId, cId) => (deckState(dId).cards[cId] ||= { box: 1, due: today(), seen: 0, ok: 0 });

/* Niveaux */
const xpForLevel = (n) => Math.round(60 * (n - 1) * n * 0.9);
function levelInfo() {
  let n = 1; while (state.xp >= xpForLevel(n + 1)) n++;
  const lo = xpForLevel(n), hi = xpForLevel(n + 1);
  return { n, pct: Math.min(100, Math.round(((state.xp - lo) / (hi - lo)) * 100)) };
}
function addXP(amount) {
  const before = levelInfo().n;
  const t = today();
  const beforeGoal = (state.activity[t] || 0) >= state.goal;
  state.xp += amount;
  state.activity[t] = (state.activity[t] || 0) + amount;
  pruneActivity();
  save(); renderTop(); renderGoal();
  if (!beforeGoal && state.activity[t] >= state.goal) {
    toast("🎯 Objectif du jour atteint !"); sfx("level"); buzz(40);
    unlock("objectif");
  }
  return levelInfo().n - before;
}
function pruneActivity() {
  const min = new Date(Date.now() - 420 * 864e5).toISOString().slice(0, 10);
  for (const k of Object.keys(state.activity)) if (k < min) delete state.activity[k];
}
function touchStreak() {
  const t = today(), s = state.streak;
  if (s.last === t) return;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  s.count = s.last === y ? s.count + 1 : 1;
  s.last = t; save(); renderTop();
  if (s.count > 1) toast(`🔥 Série de ${s.count} jours !`);
  checkBadges();
}

/* Leitner */
const INTERVALS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 16 };
const addDays = (d, n) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

/* ================= Sons & vibrations ================= */
let actx = null;
function sfx(kind) {
  if (!state.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const notes = {
      flip: [[520, 0, 0.05, 0.05]],
      ok: [[660, 0, 0.07, 0.08], [880, 0.07, 0.1, 0.08]],
      bad: [[220, 0, 0.16, 0.09], [180, 0.05, 0.14, 0.07]],
      level: [[523, 0, 0.1, 0.09], [659, 0.1, 0.1, 0.09], [784, 0.2, 0.12, 0.09], [1047, 0.32, 0.22, 0.1]],
      badge: [[784, 0, 0.09, 0.09], [988, 0.09, 0.09, 0.09], [1175, 0.18, 0.18, 0.1]],
      tick: [[740, 0, 0.04, 0.04]],
    }[kind] || [];
    for (const [f, t0, dur, vol] of notes) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === "bad" ? "sawtooth" : "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, actx.currentTime + t0);
      g.gain.linearRampToValueAtTime(vol, actx.currentTime + t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + t0 + dur);
      o.connect(g).connect(actx.destination);
      o.start(actx.currentTime + t0); o.stop(actx.currentTime + t0 + dur + 0.02);
    }
  } catch { /* audio indisponible */ }
}
const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

/* ================= Succès ================= */
const BADGES = [
  { id: "premiere", e: "🌱", t: "Premier pas", d: "Terminer une première session", test: (s) => s.sessions >= 1 },
  { id: "serie3", e: "🔥", t: "Trois d'affilée", d: "Série de 3 jours", test: () => state.streak.count >= 3 },
  { id: "serie7", e: "🌋", t: "Semaine de feu", d: "Série de 7 jours", test: () => state.streak.count >= 7 },
  { id: "serie30", e: "☄️", t: "Inarrêtable", d: "Série de 30 jours", test: () => state.streak.count >= 30 },
  { id: "niv5", e: "✦", t: "Étoile montante", d: "Atteindre le niveau 5", test: () => levelInfo().n >= 5 },
  { id: "niv10", e: "💫", t: "Constellation", d: "Atteindre le niveau 10", test: () => levelInfo().n >= 10 },
  { id: "combo", e: "⚡", t: "Combo maximal", d: "Multiplicateur ×3 en session", test: (s) => s.maxMult >= 3 },
  { id: "parfait", e: "🎯", t: "Sans faute", d: "100 % à un quiz complet", test: (s) => s.perfectQuiz },
  { id: "sprint15", e: "🏃", t: "Fusée", d: "15 bonnes réponses en un sprint", test: (s) => s.sprint15 },
  { id: "paires", e: "🧩", t: "Esprit vif", d: "Paires sans aucune erreur", test: (s) => s.perfectPairs },
  { id: "acquis10", e: "🌿", t: "Jardinier", d: "10 cartes en boîte Acquis", test: () => acquiredCount() >= 10 },
  { id: "acquis50", e: "🌳", t: "Forêt intérieure", d: "50 cartes en boîte Acquis", test: () => acquiredCount() >= 50 },
  { id: "noctambule", e: "🌙", t: "Noctambule", d: "Réviser après 22 h", test: (s) => s.hour >= 22 },
  { id: "objectif", e: "🏅", t: "Objectif rempli", d: "Atteindre l'objectif du jour", test: () => false }, // via unlock direct
];
function acquiredCount() {
  let n = 0;
  for (const d of Object.values(state.decks)) for (const c of Object.values(d.cards)) if (c.box === 5) n++;
  return n;
}
function unlock(id) {
  if (state.badges[id]) return false;
  const b = BADGES.find((x) => x.id === id);
  if (!b) return false;
  state.badges[id] = today(); save();
  setTimeout(() => { toast(`${b.e} Succès : ${b.t} !`); sfx("badge"); buzz([30, 40, 30]); }, 600);
  return true;
}
function checkBadges(ctx = {}) {
  const c = Object.assign({ sessions: Object.keys(state.activity).length ? 1 : 0, maxMult: 0, hour: new Date().getHours() }, ctx);
  let any = false;
  for (const b of BADGES) { try { if (!state.badges[b.id] && b.test(c)) any = unlock(b.id) || any; } catch {} }
  return any;
}

/* ================= Chargement des decks ================= */
let LIBRARY = [];
let current = null;
let lastMode = null;

async function loadLibrary() {
  const grid = $("#deckGrid");
  grid.innerHTML = '<div class="empty">Chargement de la bibliothèque…</div>';
  LIBRARY = [];
  try {
    const idx = await fetch("./cartes/index.json", { cache: "no-cache" }).then((r) => r.json());
    for (const d of idx.decks || []) {
      try {
        const txt = await fetch("./cartes/" + d.fichier, { cache: "no-cache" }).then((r) => r.text());
        const cards = rowsToCards(parseCSV(txt));
        if (cards.length) LIBRARY.push({ ...d, cards });
      } catch {}
    }
  } catch {}
  for (const c of state.custom) LIBRARY.push({ ...c, custom: true });
  renderLibrary(); renderGoal();
}

function deckMastery(deck) {
  const ds = deckState(deck.id);
  let sum = 0;
  for (const c of deck.cards) { const cs = ds.cards[c.id]; sum += cs ? (cs.box - 1) / 4 : 0; }
  return Math.round((sum / deck.cards.length) * 100);
}
function dueCount(deck) {
  const ds = deckState(deck.id), t = today();
  return deck.cards.filter((c) => { const cs = ds.cards[c.id]; return !cs || cs.due <= t; }).length;
}

function renderLibrary() {
  const grid = $("#deckGrid");
  if (!LIBRARY.length) { grid.innerHTML = '<div class="empty">Aucun deck pour l\'instant — importez un CSV ci-dessous 🌱</div>'; return; }
  const totalDue = LIBRARY.reduce((n, d) => n + dueCount(d), 0);
  $("#libSub").textContent = totalDue ? `${totalDue} carte${totalDue > 1 ? "s" : ""} vous attendent aujourd'hui.` : "Tout est à jour — flânez ou visez un record ✨";
  grid.innerHTML = "";
  LIBRARY.forEach((d) => {
    const due = dueCount(d), m = deckMastery(d);
    const el = document.createElement("button");
    el.className = "deck-card";
    el.innerHTML = `
      <div class="row">
        <div class="deck-emoji">${d.emoji || "🃏"}</div>
        <div><h3>${esc(d.titre)}</h3><p>${esc(d.description || "")}</p></div>
      </div>
      <div class="deck-meta">
        ${d.niveau ? `<span class="tag lilac">${esc(d.niveau)}</span>` : ""}
        <span class="tag">${d.cards.length} cartes</span>
        <span class="tag mint">${m} % maîtrisé</span>
        ${due ? `<span class="tag due">● ${due} à revoir</span>` : ""}
        ${d.custom ? `<span class="tag">perso</span>` : ""}
      </div>
      <div class="mastery"><i style="width:${m}%"></i></div>`;
    el.addEventListener("click", () => openDeck(d));
    if (d.custom) {
      const del = document.createElement("button");
      del.className = "deck-del"; del.textContent = "✕"; del.title = "Supprimer ce deck";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm(`Supprimer « ${d.titre} » ?`)) return;
        state.custom = state.custom.filter((c) => c.id !== d.id);
        delete state.decks[d.id]; save(); loadLibrary();
      });
      el.appendChild(del);
    }
    grid.appendChild(el);
  });
}

/* ================= Objectif du jour ================= */
const GOALS = [40, 80, 120, 200];
function renderGoal() {
  const done = state.activity[today()] || 0;
  const pct = Math.min(100, Math.round((done / state.goal) * 100));
  const C = 169.6;
  $("#goalArc").style.strokeDashoffset = C - (C * pct) / 100;
  $("#goalPct").textContent = pct + "%";
  $("#goalTxt").innerHTML = pct >= 100
    ? `<span class="done">${done} / ${state.goal} XP — bravo ✨</span>`
    : `${done} / ${state.goal} XP — touchez pour ajuster`;
}
$("#goalCard").addEventListener("click", () => {
  state.goal = GOALS[(GOALS.indexOf(state.goal) + 1) % GOALS.length];
  save(); renderGoal(); sfx("tick");
  toast(`Objectif quotidien : ${state.goal} XP`);
});

/* ================= Import CSV ================= */
const dz = $("#dropzone"), fi = $("#fileInput");
dz.addEventListener("click", () => fi.click());
dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fi.click(); });
["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
dz.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) importFile(f); });
fi.addEventListener("change", () => { if (fi.files[0]) importFile(fi.files[0]); fi.value = ""; });

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const cards = rowsToCards(parseCSV(String(reader.result)));
    if (cards.length < 4) { toast("CSV illisible ou trop court (4 cartes minimum)."); return; }
    const titre = file.name.replace(/\.csv$/i, "").replace(/[-_]/g, " ");
    const deck = { id: "perso-" + hash(file.name + cards.length), titre, description: "Deck importé", emoji: "📥", cards };
    state.custom = state.custom.filter((c) => c.id !== deck.id).concat(deck);
    save(); loadLibrary(); toast(`« ${titre} » importé — ${cards.length} cartes ✨`); sfx("badge");
  };
  reader.readAsText(file, "utf-8");
}

/* ================= Navigation ================= */
function show(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("#v-" + id).classList.add("active");
  window.scrollTo({ top: 0 });
}
document.querySelectorAll("[data-goto]").forEach((b) =>
  b.addEventListener("click", () => {
    stopTimer();
    const t = b.dataset.goto;
    if (t === "deck" && current) openDeck(current); else { loadLibrary(); show("library"); }
  })
);
$("#homeBtn").addEventListener("click", () => { stopTimer(); loadLibrary(); show("library"); });
$("#statsBtn").addEventListener("click", () => { stopTimer(); openStats(); });

function openDeck(d) {
  current = d;
  const ds = deckState(d.id);
  $("#deckLevel").textContent = d.niveau ? `Niveau ${d.niveau}` : "Deck";
  $("#deckTitle").textContent = d.titre;
  $("#deckDesc").textContent = d.description || "";
  const due = dueCount(d);
  $("#dueBadge").textContent = due ? `${due} dues` : "";
  $("#revP").textContent = due ? "Cartes du jour, mémorisation espacée." : "Rien n'est dû — révision libre en avance.";
  const b = ds.best;
  $("#quizBest").textContent = b.quiz ? `record ${b.quiz}` : "";
  $("#sprintBest").textContent = b.sprint ? `record ${b.sprint}` : "";
  $("#pairsBest").textContent = b.pairs ? `record ${b.pairs}s` : "";
  $("#reverseBtn").textContent = ds.reversed ? "🔁 Sens : réponse → question" : "🔁 Sens : question → réponse";
  const counts = [0, 0, 0, 0, 0];
  d.cards.forEach((c) => { const cs = ds.cards[c.id]; counts[(cs ? cs.box : 1) - 1]++; });
  $("#boxes").innerHTML = counts.map((n, i) =>
    `<div class="boxcell ${i === 4 ? "b5" : ""}"><b>${n}</b><span>${i === 4 ? "Acquis" : "Boîte " + (i + 1)}</span></div>`).join("");
  show("deck");
}
$("#mRevision").addEventListener("click", () => startReview());
$("#mQuiz").addEventListener("click", () => startQCM("quiz"));
$("#mSprint").addEventListener("click", () => startQCM("sprint"));
$("#mPairs").addEventListener("click", () => startPairs());
$("#browseBtn").addEventListener("click", () => openBrowse());
$("#reverseBtn").addEventListener("click", () => {
  const ds = deckState(current.id);
  ds.reversed = !ds.reversed; save();
  $("#reverseBtn").textContent = ds.reversed ? "🔁 Sens : réponse → question" : "🔁 Sens : question → réponse";
  toast(ds.reversed ? "Révision inversée : on devine la question." : "Révision classique : on devine la réponse.");
  sfx("tick");
});

/* ================= Session commune ================= */
let session = null;
function newSession(mode) {
  session = { mode, correct: 0, wrong: 0, combo: 0, bestCombo: 0, xp: 0, missed: [] };
  return session;
}
function comboMult() { return 1 + Math.min(4, Math.floor(session.combo / 3)) * 0.5; }
function scoreHit(base) {
  session.combo++; session.bestCombo = Math.max(session.bestCombo, session.combo);
  const pts = Math.round(base * comboMult());
  session.xp += pts; session.correct++;
  return pts;
}
function scoreMiss(card) {
  session.combo = 0; session.wrong++;
  if (card && session.missed.length < 12 && !session.missed.some((m) => m.id === card.id)) session.missed.push(card);
}
function comboLabel(el) {
  const m = comboMult();
  el.textContent = "×" + (Number.isInteger(m) ? m : m.toFixed(1));
  el.classList.toggle("hot", m > 1);
}

/* ================= Mode Révision (flip + Leitner) ================= */
let queue = [], total = 0, flipped = false, flippedOnce = false;
const oriented = (c) => (deckState(current.id).reversed ? { id: c.id, q: c.a, a: c.q } : c);
function startReview() {
  const d = current, ds = deckState(d.id), t = today();
  let due = d.cards.filter((c) => { const cs = ds.cards[c.id]; return !cs || cs.due <= t; });
  if (!due.length) due = d.cards.slice();
  queue = shuffle(due).slice(0, 20);
  total = queue.length;
  newSession("review");
  touchStreak();
  flippedOnce = false;
  show("review");
  nextCard();
}
function nextCard() {
  comboLabel($("#revCombo"));
  $("#revProg").style.width = Math.round(((total - queue.length) / total) * 100) + "%";
  if (!queue.length) return endSession();
  const c = oriented(queue[0]);
  flipped = false;
  $("#flipcard").classList.remove("flipped");
  $("#grade").classList.remove("show");
  setTimeout(() => { $("#qTxt").textContent = c.q; $("#aTxt").textContent = c.a; }, flippedOnce ? 250 : 0);
  flippedOnce = true;
}
function flip() {
  if (session?.mode !== "review") return;
  flipped = !flipped;
  $("#flipcard").classList.toggle("flipped", flipped);
  if (flipped) $("#grade").classList.add("show");
  sfx("flip");
}
$("#flipcard").addEventListener("click", flip);
$("#btnGood").addEventListener("click", () => grade(true));
$("#btnAgain").addEventListener("click", () => grade(false));
function grade(ok) {
  if (!flipped) return;
  const c = queue.shift();
  const cs = cardState(current.id, c.id);
  cs.seen++;
  if (ok) {
    cs.ok++; cs.box = Math.min(5, cs.box + 1);
    cs.due = addDays(today(), INTERVALS[cs.box]);
    const pts = scoreHit(10);
    toast(`+${pts} XP ${session.combo >= 3 ? "· combo ! " : ""}${cs.box === 5 ? "· carte acquise 🌿" : ""}`);
    sfx("ok"); buzz(15);
  } else {
    cs.box = 1; cs.due = today();
    scoreMiss(oriented(c));
    queue.push(c);
    sfx("bad"); buzz(50);
  }
  save();
  nextCard();
}

/* ================= Modes QCM (quiz & sprint) ================= */
let qcmQueue = [], qcmTotal = 0, timerId = null, timeLeft = 0, answering = false;
function startQCM(mode) {
  const d = current;
  if (d.cards.length < 4) { toast("Il faut au moins 4 cartes pour un QCM."); return; }
  newSession(mode);
  touchStreak();
  qcmQueue = shuffle(d.cards);
  if (mode === "quiz") qcmQueue = qcmQueue.slice(0, Math.min(10, qcmQueue.length));
  qcmTotal = qcmQueue.length;
  $("#qcmTimer").hidden = mode !== "sprint";
  if (mode === "sprint") {
    timeLeft = 60; renderTimer();
    timerId = setInterval(() => {
      timeLeft--; renderTimer();
      if (timeLeft <= 5 && timeLeft > 0) sfx("tick");
      if (timeLeft <= 0) { stopTimer(); endSession(); }
    }, 1000);
  }
  show("qcm");
  nextQCM();
}
function renderTimer() {
  const el = $("#qcmTimer");
  el.textContent = timeLeft + "s";
  el.classList.toggle("low", timeLeft <= 10);
}
function stopTimer() {
  if (timerId) { clearInterval(timerId); timerId = null; }
  if (pairsTimerId) { clearInterval(pairsTimerId); pairsTimerId = null; }
}
function nextQCM() {
  comboLabel($("#qcmCombo"));
  if (session.mode === "quiz") $("#qcmProg").style.width = Math.round(((qcmTotal - qcmQueue.length) / qcmTotal) * 100) + "%";
  else $("#qcmProg").style.width = Math.round((timeLeft / 60) * 100) + "%";
  if (!qcmQueue.length) {
    if (session.mode === "sprint") qcmQueue = shuffle(current.cards);
    else return endSession();
  }
  const c = qcmQueue.shift();
  answering = true;
  $("#qcmQ").textContent = c.q;
  const wrong = shuffle(current.cards.filter((x) => x.id !== c.id && x.a !== c.a)).slice(0, 3).map((x) => x.a);
  const opts = shuffle([c.a, ...wrong]);
  const box = $("#choices");
  box.innerHTML = "";
  opts.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.dataset.a = opt;
    b.innerHTML = `<span class="key">${i + 1}</span><span>${esc(opt)}</span>`;
    b.addEventListener("click", () => pick(b, opt === c.a, c));
    box.appendChild(b);
  });
}
function pick(btn, ok, card) {
  if (!answering) return;
  answering = false;
  const buttons = [...document.querySelectorAll(".choice")];
  buttons.forEach((b) => { b.disabled = true; if (b !== btn) b.classList.add("dim"); });
  const rightBtn = buttons.find((b) => b.dataset.a === card.a) || btn;
  if (ok) {
    btn.classList.add("correct");
    const pts = scoreHit(session.mode === "sprint" ? 12 : 15);
    toast(`+${pts} XP${session.combo >= 3 ? " · combo !" : ""}`);
    sfx("ok"); buzz(15);
  } else {
    btn.classList.add("wrong");
    rightBtn.classList.remove("dim"); rightBtn.classList.add("correct");
    scoreMiss(card);
    sfx("bad"); buzz(50);
  }
  const cs = cardState(current.id, card.id);
  cs.seen++;
  if (ok) { cs.ok++; if (Math.random() < 0.5) { cs.box = Math.min(5, cs.box + 1); cs.due = addDays(today(), INTERVALS[cs.box]); } }
  else { cs.box = Math.max(1, cs.box - 1); cs.due = today(); }
  save();
  setTimeout(nextQCM, ok ? 550 : 1200);
}

/* ================= Mode Paires ================= */
let pairsTimerId = null, pairsTime = 0, pairsLeft = 0, selQ = null, selA = null, pairsLock = false;
function startPairs() {
  const d = current;
  if (d.cards.length < 6) { toast("Il faut au moins 6 cartes pour le mode Paires."); return; }
  newSession("pairs");
  touchStreak();
  const picks = shuffle(d.cards).slice(0, 6);
  session.pairIds = new Set(picks.map((c) => c.id));
  pairsLeft = picks.length;
  selQ = selA = null; pairsLock = false;
  pairsTime = 0;
  $("#pairsTimer").textContent = "0s";
  $("#pairsTimer").classList.remove("low");
  $("#pairsProg").style.width = "0%";
  pairsTimerId = setInterval(() => { pairsTime++; $("#pairsTimer").textContent = pairsTime + "s"; }, 1000);

  const grid = $("#pairsGrid");
  grid.innerHTML = "";
  const qs = shuffle(picks), as = shuffle(picks);
  for (let i = 0; i < picks.length; i++) {
    const bq = document.createElement("button");
    bq.className = "pitem q"; bq.dataset.id = qs[i].id;
    bq.textContent = trunc(qs[i].q, 110);
    bq.addEventListener("click", () => pickPair(bq, "q"));
    grid.appendChild(bq);
    const ba = document.createElement("button");
    ba.className = "pitem a"; ba.dataset.id = as[i].id;
    ba.textContent = trunc(as[i].a, 110);
    ba.addEventListener("click", () => pickPair(ba, "a"));
    grid.appendChild(ba);
  }
  show("pairs");
}
function pickPair(btn, side) {
  if (pairsLock || btn.classList.contains("ok")) return;
  sfx("flip");
  if (side === "q") {
    if (selQ) selQ.classList.remove("sel");
    selQ = selQ === btn ? null : btn;
    if (selQ) selQ.classList.add("sel");
  } else {
    if (selA) selA.classList.remove("sel");
    selA = selA === btn ? null : btn;
    if (selA) selA.classList.add("sel");
  }
  if (!selQ || !selA) return;
  pairsLock = true;
  const q = selQ, a = selA;
  if (q.dataset.id === a.dataset.id) {
    const pts = scoreHit(8);
    toast(`+${pts} XP`);
    sfx("ok"); buzz(15);
    q.classList.remove("sel"); a.classList.remove("sel");
    q.classList.add("ok"); a.classList.add("ok");
    const cs = cardState(current.id, q.dataset.id);
    cs.seen++; cs.ok++;
    save();
    pairsLeft--;
    $("#pairsProg").style.width = Math.round(((6 - pairsLeft) / 6) * 100) + "%";
    selQ = selA = null; pairsLock = false;
    if (!pairsLeft) { stopTimer(); session.pairsTime = pairsTime; endSession(); }
  } else {
    const card = current.cards.find((c) => c.id === q.dataset.id);
    scoreMiss(card);
    sfx("bad"); buzz(50);
    q.classList.add("bad"); a.classList.add("bad");
    setTimeout(() => {
      q.classList.remove("sel", "bad"); a.classList.remove("sel", "bad");
      selQ = selA = null; pairsLock = false;
    }, 420);
  }
}

/* ================= Explorateur ================= */
function openBrowse() {
  $("#browseTitle").textContent = current.titre;
  $("#searchInput").value = "";
  renderBrowse("");
  show("browse");
}
function renderBrowse(filter) {
  const ds = deckState(current.id);
  const f = filter.trim().toLowerCase();
  const list = $("#browseList");
  list.innerHTML = "";
  const cards = current.cards.filter((c) => !f || c.q.toLowerCase().includes(f) || c.a.toLowerCase().includes(f));
  if (!cards.length) { list.innerHTML = '<div class="empty">Aucune carte ne correspond.</div>'; return; }
  for (const c of cards) {
    const cs = ds.cards[c.id];
    const box = cs ? cs.box : 1;
    const el = document.createElement("button");
    el.className = "bitem";
    el.innerHTML = `<div class="bq"><span class="chip ${box === 5 ? "done" : ""}">${box === 5 ? "✓" : "B" + box}</span><span>${esc(c.q)}</span></div><div class="ba">${esc(c.a)}</div>`;
    el.addEventListener("click", () => el.classList.toggle("open"));
    list.appendChild(el);
  }
}
$("#searchInput").addEventListener("input", (e) => renderBrowse(e.target.value));

/* ================= Statistiques & succès ================= */
function openStats() {
  $("#stXP").textContent = state.xp;
  $("#stAcquired").textContent = acquiredCount();
  const days = Object.keys(state.activity).filter((k) => state.activity[k] > 0).length;
  $("#stDays").textContent = days;
  $("#statsSub").textContent = `Niveau ${levelInfo().n} · série actuelle : ${state.streak.count} jour${state.streak.count > 1 ? "s" : ""} 🔥`;

  // Heatmap : 12 semaines, colonnes = semaines, lignes = lun→dim
  const hm = $("#heatmap");
  hm.innerHTML = "";
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // lundi = 0
  const start = new Date(now); start.setDate(now.getDate() - dow - 7 * 11);
  const vals = [];
  for (let w = 0; w < 12; w++) for (let d = 0; d < 7; d++) {
    const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d);
    vals.push({ key: dt.toISOString().slice(0, 10), future: dt > now });
  }
  const max = Math.max(1, ...vals.map((v) => state.activity[v.key] || 0));
  for (const v of vals) {
    const xp = state.activity[v.key] || 0;
    const i = document.createElement("i");
    if (!v.future && xp > 0) {
      const r = xp / max;
      i.className = r > 0.8 ? "l4" : r > 0.5 ? "l3" : r > 0.25 ? "l2" : "l1";
    }
    if (v.future) i.style.opacity = "0.3";
    i.title = `${v.key} — ${xp} XP`;
    hm.appendChild(i);
  }

  // Succès
  const bg = $("#badgeGrid");
  bg.innerHTML = "";
  let n = 0;
  for (const b of BADGES) {
    const has = !!state.badges[b.id];
    if (has) n++;
    const el = document.createElement("div");
    el.className = "badge-card " + (has ? "unlocked" : "locked");
    el.innerHTML = `<span class="be">${b.e}</span><h5>${b.t}</h5><p>${has ? "Débloqué le " + state.badges[b.id] : b.d}</p>`;
    bg.appendChild(el);
  }
  $("#badgeCount").textContent = `Succès — ${n} / ${BADGES.length}`;
  show("stats");
}

/* ================= Clavier ================= */
document.addEventListener("keydown", (e) => {
  if ($("#v-qcm").classList.contains("active") && ["1", "2", "3", "4"].includes(e.key)) {
    const b = document.querySelectorAll(".choice")[+e.key - 1];
    if (b && !b.disabled) b.click();
  }
  if ($("#v-review").classList.contains("active")) {
    if (e.key === " ") { e.preventDefault(); flip(); }
    if (flipped && e.key === "1") grade(false);
    if (flipped && e.key === "2") grade(true);
  }
});

/* ================= Fin de session ================= */
function endSession() {
  stopTimer();
  const s = session;
  const answered = s.correct + s.wrong;
  const gained = s.xp + (answered ? 5 : 0);
  const lvls = addXP(gained);
  $("#resBig").textContent = "+" + gained;
  $("#rsCorrect").textContent = s.correct;
  $("#rsAcc").textContent = (answered ? Math.round((s.correct / answered) * 100) : 0) + " %";
  $("#rsCombo").textContent = "×" + (1 + Math.min(4, Math.floor(s.bestCombo / 3)) * 0.5);
  $("#resEyebrow").textContent = { review: "Révision terminée", quiz: "Quiz terminé", sprint: "Sprint terminé", pairs: "Paires terminées" }[s.mode];
  if (s.mode === "pairs") { $("#resBig").textContent = s.pairsTime + "s"; $("#resLab").textContent = `pour 6 paires · +${gained} XP`; }
  else $("#resLab").textContent = "points d'expérience";

  const lu = $("#levelup");
  lu.classList.toggle("show", lvls > 0);
  if (lvls > 0) { lu.textContent = `✦ Niveau ${levelInfo().n} atteint !`; sfx("level"); }

  // records
  const rec = $("#record");
  let isRecord = false;
  const best = deckState(current.id).best;
  if (s.mode === "quiz" || s.mode === "sprint") {
    if ((!best[s.mode] || s.correct > best[s.mode]) && s.correct > 0) { best[s.mode] = s.correct; isRecord = true; save(); }
  } else if (s.mode === "pairs") {
    if (!best.pairs || s.pairsTime < best.pairs) { best.pairs = s.pairsTime; isRecord = true; save(); }
  }
  rec.classList.toggle("show", isRecord);

  // cartes ratées
  const missed = $("#missed");
  missed.classList.toggle("show", s.missed.length > 0);
  $("#missedList").innerHTML = s.missed.map((m) => `<div class="mi2">${esc(trunc(m.q, 140))}<br><b>${esc(trunc(m.a, 140))}</b></div>`).join("");

  // succès
  checkBadges({
    sessions: 1,
    maxMult: 1 + Math.min(4, Math.floor(s.bestCombo / 3)) * 0.5,
    perfectQuiz: s.mode === "quiz" && answered >= 8 && s.wrong === 0,
    sprint15: s.mode === "sprint" && s.correct >= 15,
    perfectPairs: s.mode === "pairs" && s.wrong === 0,
    hour: new Date().getHours(),
  });

  lastMode = s.mode;
  show("results");
  if (lvls > 0 || isRecord || (answered && s.correct / answered >= 0.8)) confetti();
}
$("#resAgain").addEventListener("click", () => {
  if (lastMode === "review") startReview();
  else if (lastMode === "pairs") startPairs();
  else startQCM(lastMode);
});

/* ================= Interface globale ================= */
function renderTop() {
  const li = levelInfo();
  $("#lvlN").textContent = li.n;
  $("#xpFill").style.width = li.pct + "%";
  $("#streakN").textContent = state.streak.count;
}
let toastId = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastId);
  toastId = setTimeout(() => t.classList.remove("show"), 1800);
}

/* Thème & sons */
const themeBtn = $("#themeBtn");
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === "dark" ? "☾" : "☀";
  localStorage.setItem("decks-theme", t);
  document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#0C120F" : "#F3F6F1";
}
applyTheme(localStorage.getItem("decks-theme") || "dark");
themeBtn.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
const soundBtn = $("#soundBtn");
function renderSound() { soundBtn.textContent = state.sound ? "♪" : "♪̶"; soundBtn.style.opacity = state.sound ? "1" : ".45"; }
renderSound();
soundBtn.addEventListener("click", () => { state.sound = !state.sound; save(); renderSound(); if (state.sound) sfx("ok"); });

/* ================= Confettis ================= */
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("#confetti"), ctx = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ["#A5E8C2", "#C9B3F5", "#6FD9A2", "#A98BEF", "#F2DCA6"];
  const parts = Array.from({ length: 120 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.4,
    r: 4 + Math.random() * 5, c: colors[(Math.random() * colors.length) | 0],
    vy: 2.2 + Math.random() * 3, vx: -1.5 + Math.random() * 3,
    a: Math.random() * Math.PI, va: -0.15 + Math.random() * 0.3,
  }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
    }
    if (++frames < 160) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

/* ================= Démarrage ================= */
renderTop();
loadLibrary();
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

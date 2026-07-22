/* Decks — flashcards gamifiées
   Statique, hors-ligne, données locales (localStorage). */
"use strict";

/* ================= Utilitaires ================= */
const $ = (s) => document.querySelector(s);
const today = () => new Date().toISOString().slice(0, 10);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

/* Analyseur CSV (RFC 4180 : guillemets, virgules et sauts de ligne dans les champs) */
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
    const ql = q.toLowerCase();
    if (["question", "recto", "front", "q"].includes(ql)) continue; // en-tête éventuel
    cards.push({ id: hash(q), q: pretty(q), a: pretty(a) });
  }
  return cards;
}

/* ================= État persistant ================= */
const KEY = "decks-app-v1";
const state = load();
function load() {
  try { return Object.assign({ xp: 0, streak: { last: null, count: 0 }, decks: {}, custom: [] }, JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch { return { xp: 0, streak: { last: null, count: 0 }, decks: {}, custom: [] }; }
}
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const deckState = (id) => (state.decks[id] ||= { cards: {}, best: {} });
const cardState = (dId, cId) => (deckState(dId).cards[cId] ||= { box: 1, due: today(), seen: 0, ok: 0 });

/* Niveaux : xp cumulé requis pour atteindre le niveau n */
const xpForLevel = (n) => Math.round(60 * (n - 1) * n * 0.9);
function levelInfo() {
  let n = 1; while (state.xp >= xpForLevel(n + 1)) n++;
  const lo = xpForLevel(n), hi = xpForLevel(n + 1);
  return { n, pct: Math.min(100, Math.round(((state.xp - lo) / (hi - lo)) * 100)) };
}
function addXP(amount) {
  const before = levelInfo().n;
  state.xp += amount; save(); renderTop();
  return levelInfo().n - before; // niveaux gagnés
}
function touchStreak() {
  const t = today(), s = state.streak;
  if (s.last === t) return;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  s.count = s.last === y ? s.count + 1 : 1;
  s.last = t; save(); renderTop();
  if (s.count > 1) toast(`🔥 Série de ${s.count} jours !`);
}

/* Leitner : intervalles en jours par boîte */
const INTERVALS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 16 };
const addDays = (d, n) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

/* ================= Chargement des decks ================= */
let LIBRARY = []; // {id, titre, description, niveau, emoji, cards, custom}
let current = null; // deck actif
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
      } catch { /* deck manquant : on ignore */ }
    }
  } catch { /* index absent (premier déploiement) */ }
  for (const c of state.custom) LIBRARY.push({ ...c, custom: true });
  renderLibrary();
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
    save(); loadLibrary(); toast(`« ${titre} » importé — ${cards.length} cartes ✨`);
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

function openDeck(d) {
  current = d;
  $("#deckLevel").textContent = d.niveau ? `Niveau ${d.niveau}` : "Deck";
  $("#deckTitle").textContent = d.titre;
  $("#deckDesc").textContent = d.description || "";
  const due = dueCount(d);
  $("#dueBadge").textContent = due ? `${due} dues` : "";
  $("#revP").textContent = due ? "Cartes du jour, mémorisation espacée." : "Rien n'est dû — révision libre en avance.";
  const b = deckState(d.id).best;
  $("#quizBest").textContent = b.quiz ? `record ${b.quiz}` : "";
  $("#sprintBest").textContent = b.sprint ? `record ${b.sprint}` : "";
  const counts = [0, 0, 0, 0, 0];
  const ds = deckState(d.id);
  d.cards.forEach((c) => { const cs = ds.cards[c.id]; counts[(cs ? cs.box : 1) - 1]++; });
  $("#boxes").innerHTML = counts.map((n, i) =>
    `<div class="boxcell ${i === 4 ? "b5" : ""}"><b>${n}</b><span>${i === 4 ? "Acquis" : "Boîte " + (i + 1)}</span></div>`).join("");
  show("deck");
}
$("#mRevision").addEventListener("click", () => startReview());
$("#mQuiz").addEventListener("click", () => startQCM("quiz"));
$("#mSprint").addEventListener("click", () => startQCM("sprint"));

/* ================= Session commune ================= */
let session = null;
function newSession(mode) {
  session = { mode, correct: 0, wrong: 0, combo: 0, bestCombo: 0, xp: 0 };
  return session;
}
function comboMult() { return 1 + Math.min(4, Math.floor(session.combo / 3)) * 0.5; } // ×1 → ×3
function scoreHit(base) {
  session.combo++; session.bestCombo = Math.max(session.bestCombo, session.combo);
  const pts = Math.round(base * comboMult());
  session.xp += pts; session.correct++;
  return pts;
}
function scoreMiss() { session.combo = 0; session.wrong++; }
function comboLabel(el) {
  const m = comboMult();
  el.textContent = "×" + (Number.isInteger(m) ? m : m.toFixed(1));
  el.classList.toggle("hot", m > 1);
}

/* ================= Mode Révision (flip + Leitner) ================= */
let queue = [], total = 0, flipped = false, flippedOnce = false;
function startReview() {
  const d = current, ds = deckState(d.id), t = today();
  let due = d.cards.filter((c) => { const cs = ds.cards[c.id]; return !cs || cs.due <= t; });
  const ahead = !due.length;
  if (ahead) due = d.cards.slice(); // révision libre
  queue = shuffle(due).slice(0, 20);
  total = queue.length;
  newSession("review"); session.ahead = ahead;
  touchStreak();
  show("review");
  nextCard();
}
function nextCard() {
  comboLabel($("#revCombo"));
  $("#revProg").style.width = Math.round(((total - queue.length) / total) * 100) + "%";
  if (!queue.length) return endSession();
  const c = queue[0];
  flipped = false;
  const fc = $("#flipcard");
  fc.classList.remove("flipped");
  $("#grade").classList.remove("show");
  setTimeout(() => { $("#qTxt").textContent = c.q; $("#aTxt").textContent = c.a; }, flippedOnce ? 250 : 0);
  flippedOnce = true;
}
function flip() {
  if (session?.mode !== "review") return;
  flipped = !flipped;
  $("#flipcard").classList.toggle("flipped", flipped);
  if (flipped) $("#grade").classList.add("show");
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
  } else {
    cs.box = 1; cs.due = today(); scoreMiss();
    if (queue.length) queue.push(c); // repasse en fin de session
    else queue.push(c), total++;
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
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
function nextQCM() {
  comboLabel($("#qcmCombo"));
  if (session.mode === "quiz") $("#qcmProg").style.width = Math.round(((qcmTotal - qcmQueue.length) / qcmTotal) * 100) + "%";
  else $("#qcmProg").style.width = Math.round((timeLeft / 60) * 100) + "%";
  if (!qcmQueue.length) {
    if (session.mode === "sprint") { qcmQueue = shuffle(current.cards); } // le sprint boucle
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
  } else {
    btn.classList.add("wrong");
    rightBtn.classList.remove("dim"); rightBtn.classList.add("correct");
    scoreMiss();
  }
  /* le QCM nourrit aussi la mémorisation, plus doucement */
  const cs = cardState(current.id, card.id);
  cs.seen++;
  if (ok) { cs.ok++; if (Math.random() < 0.5) { cs.box = Math.min(5, cs.box + 1); cs.due = addDays(today(), INTERVALS[cs.box]); } }
  else { cs.box = Math.max(1, cs.box - 1); cs.due = today(); }
  save();
  setTimeout(nextQCM, ok ? 550 : 1200);
}
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
  const gained = s.xp + (answered ? 5 : 0); // petite prime de participation
  const lvls = addXP(gained);
  $("#resBig").textContent = "+" + gained;
  $("#rsCorrect").textContent = s.correct;
  $("#rsAcc").textContent = (answered ? Math.round((s.correct / answered) * 100) : 0) + " %";
  $("#rsCombo").textContent = "×" + (1 + Math.min(4, Math.floor(s.bestCombo / 3)) * 0.5);
  $("#resEyebrow").textContent = { review: "Révision terminée", quiz: "Quiz terminé", sprint: "Sprint terminé" }[s.mode];
  const lu = $("#levelup");
  lu.classList.toggle("show", lvls > 0);
  if (lvls > 0) lu.textContent = `✦ Niveau ${levelInfo().n} atteint !`;
  const rec = $("#record");
  let isRecord = false;
  if (s.mode !== "review") {
    const best = deckState(current.id).best;
    const score = s.correct;
    if (!best[s.mode] || score > best[s.mode]) { best[s.mode] = score; isRecord = score > 0; save(); }
  }
  rec.classList.toggle("show", isRecord);
  lastMode = s.mode;
  show("results");
  if (lvls > 0 || isRecord || (answered && s.correct / answered >= 0.8)) confetti();
}
$("#resAgain").addEventListener("click", () => {
  if (lastMode === "review") startReview(); else startQCM(lastMode);
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

/* Thème */
const themeBtn = $("#themeBtn");
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === "dark" ? "☾" : "☀";
  localStorage.setItem("decks-theme", t);
  document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#0C120F" : "#F3F6F1";
}
applyTheme(localStorage.getItem("decks-theme") || "dark");
themeBtn.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

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

/* LouiesRepos CID IPC Quiz
   - Instant feedback: always ON
   - Show meta: always ON
   - Answer order: NOT shuffled (MC A/B/C/D stays in order; TF stays True/False)
   - Chapters filter
   - Dynamic question count options based on mode + selected chapters (max 6 options)
   - Robust JSON load (tries filename variants)
   - Ignores questions with missing/unknown chapter (removes the 4)
*/

const els = {
  year: document.getElementById("year"),
  loadStatus: document.getElementById("loadStatus"),

  setup: document.getElementById("screenSetup"),
  quiz: document.getElementById("screenQuiz"),
  results: document.getElementById("screenResults"),

  btnStart: document.getElementById("btnStart"),
  btnReset: document.getElementById("btnReset"),
  btnAbout: document.getElementById("btnAbout"),

  aboutModal: document.getElementById("aboutModal"),
  btnCloseAbout: document.getElementById("btnCloseAbout"),
  aboutBackdrop: document.getElementById("aboutBackdrop"),

  modeSeg: document.getElementById("modeSeg"),
  countSeg: document.getElementById("countSeg"),

  chaptersBox: document.getElementById("chaptersBox"),
  btnSelectAll: document.getElementById("btnSelectAll"),
  btnSelectNone: document.getElementById("btnSelectNone"),

  qCounter: document.getElementById("qCounter"),
  scoreLive: document.getElementById("scoreLive"),
  progressFill: document.getElementById("progressFill"),
  questionText: document.getElementById("questionText"),
  metaLine: document.getElementById("metaLine"),
  answers: document.getElementById("answers"),
  btnPrev: document.getElementById("btnPrev"),
  btnNext: document.getElementById("btnNext"),
  feedback: document.getElementById("feedback"),
  modePill: document.getElementById("modePill"),

  finalPercent: document.getElementById("finalPercent"),
  finalSummary: document.getElementById("finalSummary"),
  strongest: document.getElementById("strongest"),
  weakest: document.getElementById("weakest"),
  strongHint: document.getElementById("strongHint"),
  weakHint: document.getElementById("weakHint"),
  reviewList: document.getElementById("reviewList"),
  btnRestart: document.getElementById("btnRestart"),
  btnRetakeWeak: document.getElementById("btnRetakeWeak"),
};

els.year.textContent = String(new Date().getFullYear());

const MODE_LABEL = { mc: "Multiple Choice", tf: "True / False", mix: "Combined" };
const LETTERS = ["A","B","C","D","E","F"];

let bankMC = [];
let bankTF = [];

let settings = {
  mode: "mc",
  count: 10,
  selectedChapters: new Set(),
};

let quizState = {
  questions: [],
  index: 0,
  selected: new Map(),
  locked: new Map(),
  correct: 0,
  chapter: new Map(),
  history: []
};

function safeText(v){ return (v === null || v === undefined) ? "" : String(v).trim(); }
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function normChapter(q){
  const c = safeText(q.chapter);
  return c;
}
function isUnknownChapter(ch){
  const s = safeText(ch).toLowerCase();
  return !s || s === "unknown" || s === "unknown chapter" || s === "unknown chapter(s)" || s === "n/a";
}
function questionKey(q){
  return `${safeText(q.type)}#${safeText(q.id)}#${safeText(q.chapter)}#${safeText(q.question).slice(0,64)}`;
}
function getCorrectIndex(answers){ return answers.findIndex(a => a && a.correct === true); }

function formatMeta(q){
  const parts = [];
  if (!isUnknownChapter(q.chapter)) parts.push(safeText(q.chapter));
  const sec = safeText(q.section);
  const pg = safeText(q.page);
  if (sec) parts.push(sec);
  if (pg) parts.push(pg);
  return parts.join(" • ");
}

function setScreen(which){
  els.setup.classList.toggle("hidden", which !== "setup");
  els.quiz.classList.toggle("hidden", which !== "quiz");
  els.results.classList.toggle("hidden", which !== "results");
}
function setLoadStatus(msg, ok=true){
  els.loadStatus.textContent = msg;
  els.loadStatus.style.borderStyle = ok ? "dashed" : "solid";
  els.loadStatus.style.borderColor = ok ? "rgba(39,50,71,.85)" : "rgba(255,91,110,.65)";
}
function updateModePill(){
  els.modePill.textContent = MODE_LABEL[settings.mode] ?? "Quiz";
}
function chapterSort(a, b){
  const ax = extractChapterNumber(a);
  const bx = extractChapterNumber(b);

  // If both have numbers, sort numerically
  if (ax !== null && bx !== null) return ax - bx;

  // If only one has a number, put numbered chapters first
  if (ax !== null && bx === null) return -1;
  if (ax === null && bx !== null) return 1;

  // Otherwise fallback to normal text sort
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function extractChapterNumber(ch){
  // Matches: "Chapter 1", "chapter 10", "CHAPTER 2A" (takes leading number)
  const m = String(ch).match(/chapter\s*(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/* ---------- Robust JSON loading ---------- */
async function loadJSONAny(paths){
  let lastErr = null;
  for (const p of paths){
    try{
      const res = await fetch(p, { cache: "no-store" });
      if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}`);
      return await res.json();
    }catch(e){
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Failed to load JSON.");
}

/* Normalize & drop “unknown chapter” questions (your 4) */
function normalizeBank(raw, type){
  return (Array.isArray(raw) ? raw : [])
    .map(item => ({
      type,
      id: item.id,
      question: item.question,
      chapter: item.chapter,
      section: item.section,
      page: item.page,
      note: item.note,
      answers: Array.isArray(item.answers) ? item.answers.map(a => ({
        label: safeText(a.label),
        text: safeText(a.text ?? a.label),
        correct: a.correct === true
      })) : []
    }))
    .filter(q => safeText(q.question).length > 0)
    .filter(q => q.answers.length >= 2 && getCorrectIndex(q.answers) !== -1)
    .filter(q => !isUnknownChapter(q.chapter)); // <- ignores those 4
}

/* ---------- Chapter list ---------- */
function buildChapterIndex(){
  const map = new Map(); // chapter -> {mc, tf, total}
  const add = (q) => {
    const ch = normChapter(q);
    if (isUnknownChapter(ch)) return;
    if (!map.has(ch)) map.set(ch, { mc: 0, tf: 0, total: 0 });
    const s = map.get(ch);
    s.total += 1;
    if (q.type === "mc") s.mc += 1;
    if (q.type === "tf") s.tf += 1;
  };
  bankMC.forEach(add);
  bankTF.forEach(add);
  return map;
}

function renderChapters(){
  const chapterMap = buildChapterIndex();
  const chapters = [...chapterMap.keys()].sort(chapterSort);

  settings.selectedChapters = new Set(chapters);

  els.chaptersBox.innerHTML = "";
  if (!chapters.length){
    els.chaptersBox.innerHTML = `<div class="status">No chapters found in question banks.</div>`;
    settings.selectedChapters.clear();
    refreshCountsAndStart();
    return;
  }

  const frag = document.createDocumentFragment();

  chapters.forEach(ch => {
    const stats = chapterMap.get(ch);

    const row = document.createElement("label");
    row.className = "chapterRow";

    const left = document.createElement("div");
    left.className = "chapterLeft";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => {
      if (cb.checked) settings.selectedChapters.add(ch);
      else settings.selectedChapters.delete(ch);
      refreshCountsAndStart();
    });

    const name = document.createElement("div");
    name.className = "chapterName";
    name.title = ch;
    name.textContent = ch;

    left.appendChild(cb);
    left.appendChild(name);

    const count = document.createElement("div");
    count.className = "chapterCount";
    count.textContent = `${stats.total} Q`;

    row.appendChild(left);
    row.appendChild(count);

    frag.appendChild(row);
  });

  els.chaptersBox.appendChild(frag);

  els.btnSelectAll.onclick = () => {
    settings.selectedChapters = new Set(chapters);
    els.chaptersBox.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    refreshCountsAndStart();
  };

  els.btnSelectNone.onclick = () => {
    settings.selectedChapters.clear();
    els.chaptersBox.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    refreshCountsAndStart();
  };

  refreshCountsAndStart();
}

/* ---------- Dynamic count options ---------- */
function currentPool(){
  let pool = [];
  if (settings.mode === "mc") pool = bankMC;
  else if (settings.mode === "tf") pool = bankTF;
  else pool = [...bankMC, ...bankTF];

  // filter by selected chapters
  const sel = settings.selectedChapters;
  pool = pool.filter(q => sel.has(normChapter(q)));

  return pool;
}

function sensibleCounts(max){
  if (max <= 0) return [];

  const uniq = new Set();

  // helpers
  const add = (n) => { if (n >= 1 && n <= max) uniq.add(n); };
  const roundTo = (n, step) => Math.round(n / step) * step;

  // Always include max
  add(max);

  if (max <= 13){
    add(5);
    add(10);
    add(max);
  } else if (max <= 25){
    add(10);
    add(15);
    add(20);
    add(max);
  } else if (max <= 60){
    add(10);
    add(25);
    add(50);
    add(max);
  } else if (max <= 124){
    add(10);
    add(25);
    add(50);
    add(75);
    add(100);
    add(max);
  } else {
    // big pools: keep it clean and “round”
    add(10);
    add(25);
    add(50);
    add(75);
    add(100);
    add(max);
  }

  // Ensure no more than 6 options:
  let arr = [...uniq].sort((a,b)=>a-b);

  // If we ended up with too many, keep small + near max
  if (arr.length > 6){
    const keep = new Set();
    // keep up to 3 smallest
    arr.slice(0, 3).forEach(n => keep.add(n));
    // keep max
    keep.add(max);
    // keep near max (like 75% rounded)
    const near = clamp(roundTo(max * 0.8, max >= 100 ? 25 : 10), 1, max);
    keep.add(near);

    arr = [...keep].sort((a,b)=>a-b);

    // if still > 6, trim middle
    while (arr.length > 6){
      arr.splice(2, 1);
    }
  }

  // Replace awkward values if possible (e.g., 80 when max=124 is fine, but prefer 75/100 etc)
  // (Already handled by preset choices above.)

  return arr;
}

function renderCountButtons(){
  const pool = currentPool();
  const max = pool.length;

  const counts = sensibleCounts(max);

  els.countSeg.innerHTML = "";

  if (!counts.length){
    els.countSeg.innerHTML = `<div class="status">No questions available for the selected chapters.</div>`;
    settings.count = 0;
    els.btnStart.disabled = true;
    setLoadStatus("Select at least 1 chapter with questions to start.", false);
    return;
  }

  // Clamp current selection to max
  if (settings.count <= 0 || settings.count > max){
    settings.count = counts[Math.min(1, counts.length - 1)] ?? counts[0];
  }
  if (!counts.includes(settings.count)) settings.count = counts[counts.length - 1];

  counts.forEach((n, idx) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg" + (n === settings.count ? " active" : "");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", n === settings.count ? "true" : "false");
    b.textContent = String(n);
    b.addEventListener("click", () => {
      settings.count = n;
      renderCountButtons();
      refreshStartEnabled();
    });
    els.countSeg.appendChild(b);
  });

  // Helpful status
  setLoadStatus(`Ready: ${max} question(s) available with current filters.`, true);
  refreshStartEnabled();
}

function refreshStartEnabled(){
  const max = currentPool().length;
  const ok = settings.selectedChapters.size > 0 && max > 0 && settings.count > 0;
  els.btnStart.disabled = !ok;
}

function refreshCountsAndStart(){
  renderCountButtons();
}

/* ---------- Quiz build / run ---------- */
function hardReset(){
  quizState = {
    questions: [],
    index: 0,
    selected: new Map(),
    locked: new Map(),
    correct: 0,
    chapter: new Map(),
    history: []
  };
  els.feedback.textContent = "";
  els.btnNext.disabled = true;
  els.btnPrev.disabled = true;
}

function buildQuizQuestions({ chapterFilter=null }){
  let pool = currentPool();

  if (chapterFilter){
    pool = pool.filter(q => normChapter(q) === chapterFilter);
  }

  // Pick N without shuffling answers
  // Shuffle question order only:
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, clamp(settings.count, 1, shuffled.length));
}

function bumpChapterStats(q, isCorrect){
  const chapter = normChapter(q);
  if (!quizState.chapter.has(chapter)){
    quizState.chapter.set(chapter, { correct: 0, total: 0 });
  }
  const s = quizState.chapter.get(chapter);
  s.total += 1;
  if (isCorrect) s.correct += 1;
}

function startQuiz(chapterFilter=null){
  hardReset();

  quizState.questions = buildQuizQuestions({ chapterFilter });

  if (!quizState.questions.length){
    setLoadStatus("No questions match your selection.", false);
    setScreen("setup");
    return;
  }

  updateModePill();
  setScreen("quiz");
  renderQuestion();
}

function updateProgress(){
  const total = quizState.questions.length;
  const idx = quizState.index;
  els.qCounter.textContent = `Question ${idx + 1}/${total}`;
  const percent = total ? Math.round((quizState.correct / total) * 100) : 0;
  els.scoreLive.textContent = `Score: ${percent}%`;
  const prog = total ? Math.round(((idx + 1) / total) * 100) : 0;
  els.progressFill.style.width = `${prog}%`;
  const pb = document.querySelector(".progressBar");
  if (pb) pb.setAttribute("aria-valuenow", String(prog));
}

function renderQuestion(){
  const q = quizState.questions[quizState.index];
  if (!q) return;

  updateProgress();
  els.questionText.textContent = safeText(q.question);
  els.metaLine.textContent = formatMeta(q) || safeText(q.chapter) || "";

  els.answers.innerHTML = "";
  els.feedback.textContent = "";

  const key = questionKey(q);
  const locked = quizState.locked.get(key) === true;

  const selectedIndex = quizState.selected.has(key) ? quizState.selected.get(key) : null;
  const correctIndex = getCorrectIndex(q.answers);

  q.answers.forEach((a, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "answerBtn";
    btn.dataset.index = String(i);

    const badge = document.createElement("div");
    badge.className = "badge";
    // Always A/B/C/D… even for True/False
    badge.textContent = LETTERS[i] ?? String(i + 1);

    const text = document.createElement("div");
    text.className = "answerText";
    text.textContent = safeText(a.text || a.label);

    btn.appendChild(badge);
    btn.appendChild(text);

    if (locked){
      btn.disabled = true;
      if (i === correctIndex) btn.classList.add("correct");
      else if (selectedIndex === i && i !== correctIndex) btn.classList.add("wrong");
    }

    btn.addEventListener("click", () => handleAnswer(i));
    els.answers.appendChild(btn);
  });

  els.btnPrev.disabled = quizState.index === 0;
  els.btnNext.disabled = !locked;

  if (locked){
    const last = quizState.history.find(h => questionKey(h.q) === key);
    if (last) els.feedback.textContent = last.isCorrect ? "Correct ✅" : "Incorrect ❌";
  }

  const firstBtn = els.answers.querySelector(".answerBtn");
  if (firstBtn) firstBtn.focus({ preventScroll: true });
}

function handleAnswer(selectedIndex){
  const q = quizState.questions[quizState.index];
  const key = questionKey(q);
  if (quizState.locked.get(key) === true) return;

  quizState.selected.set(key, selectedIndex);

  const correctIndex = getCorrectIndex(q.answers);
  const isCorrect = selectedIndex === correctIndex;

  quizState.locked.set(key, true);
  if (isCorrect) quizState.correct += 1;

  bumpChapterStats(q, isCorrect);
  quizState.history.push({ q, selectedIndex, correctIndex, isCorrect });

  const btns = [...els.answers.querySelectorAll(".answerBtn")];
  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === correctIndex) b.classList.add("correct");
    else if (i === selectedIndex && !isCorrect) b.classList.add("wrong");
  });

  els.btnNext.disabled = false;
  els.feedback.textContent = isCorrect ? "Correct ✅" : "Incorrect ❌";
  updateProgress();
}

function goNext(){
  const total = quizState.questions.length;
  if (quizState.index < total - 1){
    quizState.index += 1;
    renderQuestion();
  }else{
    showResults();
  }
}
function goPrev(){
  if (quizState.index > 0){
    quizState.index -= 1;
    renderQuestion();
  }
}

/* ---------- Results ---------- */
function computeInsights(){
  const entries = [...quizState.chapter.entries()]
    .map(([chapter, s]) => ({
      chapter,
      correct: s.correct,
      total: s.total,
      acc: s.total ? (s.correct / s.total) : 0
    }))
    .sort((a,b) => b.acc - a.acc || b.total - a.total);

  if (!entries.length) return { strongest: null, weakest: null };
  const strongest = entries[0];
  const weakest = [...entries].sort((a,b) => a.acc - b.acc || b.total - a.total)[0];
  return { strongest, weakest };
}

function escapeHTML(s){
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showResults(){
  const total = quizState.questions.length;
  const pct = total ? Math.round((quizState.correct / total) * 100) : 0;

  els.finalPercent.textContent = `${pct}%`;
  els.finalSummary.textContent = `${quizState.correct} / ${total} correct`;

  const { strongest, weakest } = computeInsights();

  if (strongest){
    const strongestPct = Math.round(strongest.acc * 100);
    els.strongest.textContent = `${strongest.chapter} (${strongestPct}% • ${strongest.correct}/${strongest.total})`;
    els.strongHint.textContent = strongestPct >= 80
      ? "Keep it fresh with mixed quizzes."
      : "Good progress—top it up with a short focused review.";
  }else{
    els.strongest.textContent = "—";
  }

  if (weakest){
    const weakestPct = Math.round(weakest.acc * 100);
    els.weakest.textContent = `${weakest.chapter} (${weakestPct}% • ${weakest.correct}/${weakest.total})`;
    els.weakHint.textContent = weakestPct >= 70
      ? "Not bad—push it higher with targeted questions."
      : "Prioritise this chapter next for the biggest score gain.";
  }else{
    els.weakest.textContent = "—";
  }

  renderReview();
  setScreen("results");

  els.btnRetakeWeak.disabled = !weakest;
  els.btnRetakeWeak.onclick = () => {
    if (!weakest) return;
    setScreen("setup");
    startQuiz(weakest.chapter);
  };
}

function renderReview(){
  els.reviewList.innerHTML = "";
  quizState.history.forEach((h, i) => {
    const q = h.q;
    const selected = q.answers[h.selectedIndex];
    const correct = q.answers[h.correctIndex];

    const wrap = document.createElement("div");
    wrap.className = "reviewItem";

    const qEl = document.createElement("div");
    qEl.className = "reviewQ";
    qEl.textContent = `${i + 1}. ${safeText(q.question)}`;

    const aEl = document.createElement("div");
    aEl.className = "reviewAnswer";
    aEl.innerHTML =
      `<span class="${h.isCorrect ? "ok" : "no"}">${h.isCorrect ? "Correct" : "Incorrect"}</span>` +
      ` • You chose: <span class="mono">${escapeHTML(LETTERS[h.selectedIndex] ?? "?")}</span> ${escapeHTML(selected?.text ?? "")}` +
      ` • Correct: <span class="mono">${escapeHTML(LETTERS[h.correctIndex] ?? "?")}</span> ${escapeHTML(correct?.text ?? "")}`;

    const metaEl = document.createElement("div");
    metaEl.className = "reviewMeta";
    metaEl.textContent = formatMeta(q) || safeText(q.chapter) || "";

    wrap.appendChild(qEl);
    wrap.appendChild(aEl);
    wrap.appendChild(metaEl);

    els.reviewList.appendChild(wrap);
  });
}

/* ---------- UI bindings ---------- */
function setActiveSeg(button){
  const group = button.parentElement;
  group.querySelectorAll(".seg").forEach(b => {
    b.classList.toggle("active", b === button);
    b.setAttribute("aria-selected", b === button ? "true" : "false");
  });
}

els.modeSeg.querySelectorAll("[data-mode]").forEach(btn => {
  btn.addEventListener("click", () => {
    setActiveSeg(btn);
    settings.mode = btn.getAttribute("data-mode");
    updateModePill();
    refreshCountsAndStart();
  });
});

els.btnStart.addEventListener("click", () => startQuiz());
els.btnPrev.addEventListener("click", goPrev);
els.btnNext.addEventListener("click", goNext);

els.btnReset.addEventListener("click", () => {
  hardReset();
  setScreen("setup");
});

els.btnRestart.addEventListener("click", () => setScreen("setup"));

els.btnAbout.addEventListener("click", () => els.aboutModal.classList.remove("hidden"));
els.btnCloseAbout.addEventListener("click", () => els.aboutModal.classList.add("hidden"));
els.aboutBackdrop.addEventListener("click", () => els.aboutModal.classList.add("hidden"));

document.addEventListener("keydown", (e) => {
  if (!els.aboutModal.classList.contains("hidden")) return;
  if (els.quiz.classList.contains("hidden")) return;

  const q = quizState.questions[quizState.index];
  if (!q) return;

  const key = questionKey(q);
  const locked = quizState.locked.get(key) === true;

  if (e.key === "Enter"){
    if (locked) goNext();
    return;
  }
  if (e.key === "Backspace"){
    if (quizState.index > 0) goPrev();
    return;
  }

  const n = parseInt(e.key, 10);
  if (!Number.isNaN(n)){
    const idx = n - 1;
    if (!locked && idx >= 0 && idx < q.answers.length) handleAnswer(idx);
    return;
  }

  if (!locked){
    if (e.key.toLowerCase() === "t"){
      const idx = q.answers.findIndex(a => safeText(a.text).toLowerCase() === "true" || safeText(a.label).toLowerCase() === "true");
      if (idx !== -1) handleAnswer(idx);
    }
    if (e.key.toLowerCase() === "f"){
      const idx = q.answers.findIndex(a => safeText(a.text).toLowerCase() === "false" || safeText(a.label).toLowerCase() === "false");
      if (idx !== -1) handleAnswer(idx);
    }
  }
});

/* ---------- Boot ---------- */
async function init(){
  try{
    setLoadStatus("Loading question banks…");
    els.btnStart.disabled = true;

    // Try a few common filename variants (fixes GitHub Pages/case issues)
    const rawMC = await loadJSONAny(["./MULTICHOICE.json","./multichoice.json","./MULTICHOICE.JSON","./Multichoice.json"]);
    const rawTF = await loadJSONAny(["./TRUEORFALSE.json","./trueorfalse.json","./TRUEORFALSE.JSON","./TrueOrFalse.json"]);

    bankMC = normalizeBank(rawMC, "mc");
    bankTF = normalizeBank(rawTF, "tf");

    const total = bankMC.length + bankTF.length;
    if (!total) throw new Error("No questions found after parsing.");

    setLoadStatus(`Loaded ${bankMC.length} multiple choice + ${bankTF.length} true/false questions.`, true);

    renderChapters();
    updateModePill();
    refreshCountsAndStart();
  }catch(err){
    console.error(err);
    setLoadStatus(
      `Failed to load JSON on this browser. Check file names + hosting. (Open DevTools → Console / Network).`,
      false
    );
    els.chaptersBox.innerHTML =
      `<div class="status">Failed to load chapters. Make sure the JSON files are next to index.html and served via http(s), not file://</div>`;
    els.countSeg.innerHTML = `<div class="status">Counts unavailable.</div>`;
    els.btnStart.disabled = true;
  }
}

init();

const setup = document.querySelector("#setup");
const runner = document.querySelector("#runner");
const results = document.querySelector("#results");
const optionsRoot = document.querySelector("#part-options");
const testOptionsRoot = document.querySelector("#test-options");
const startButton = document.querySelector("#start");
const resumeButton = document.querySelector("#resume");
const previousButton = document.querySelector("#previous");
const nextButton = document.querySelector("#next");
const groupCard = document.querySelector("#group-card");
const progressLabel = document.querySelector("#progress-label");
const answeredLabel = document.querySelector("#answered-label");
const progressBar = document.querySelector("#progress-bar");
const errorRoot = document.querySelector("#setup-error");

const STORAGE_KEY = "toeic:mixed-quiz";
const AUTO_ADVANCE_DELAY = 900;
const partNames = {
  1: "Photographs", 2: "Question–Response", 3: "Conversations",
  4: "Talks", 5: "Incomplete Sentences", 6: "Text Completion", 7: "Reading",
};

let groups = [];
let questionsByTest = {};
let session = null;
let submitted = false;
let audioContext = null;

function discardAudioContext() {
  const staleContext = audioContext;
  audioContext = null;
  if (!staleContext || staleContext.state === "closed") return;
  try {
    const closing = staleContext.close();
    if (closing?.catch) closing.catch(() => {});
  } catch {
    // Some browsers reject close while restoring a sleeping page.
  }
}

async function runningAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (audioContext?.state === "closed") audioContext = null;
  audioContext ??= new AudioContextClass();
  if (audioContext.state !== "running") {
    try {
      await audioContext.resume();
    } catch {
      // A stale context is replaced below.
    }
  }
  if (audioContext.state === "running") return audioContext;
  discardAudioContext();
  audioContext = new AudioContextClass();
  if (audioContext.state !== "running") await audioContext.resume();
  return audioContext.state === "running" ? audioContext : null;
}

function scheduleTone(context, frequency, start, duration, type = "sine", endFrequency = frequency) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.26, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

async function playFeedbackSound(isCorrect) {
  try {
    const context = await runningAudioContext();
    if (!context) return;
    const start = context.currentTime + 0.01;
    if (isCorrect) {
      scheduleTone(context, 523.25, start, 0.16);
      scheduleTone(context, 659.25, start + 0.09, 0.18);
      scheduleTone(context, 783.99, start + 0.18, 0.22);
    } else {
      scheduleTone(context, 220, start, 0.3, "triangle", 130);
    }
  } catch {
    // Quiz feedback remains usable when Web Audio is unavailable.
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") discardAudioContext();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) discardAudioContext();
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function questionKey(testId, number) {
  return `${testId}-question-${number}`;
}

function hashSeed(text) {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function saveSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function selectedParts() {
  return [...optionsRoot.querySelectorAll("input:checked")].map((input) => Number(input.value));
}

function selectedTests() {
  return [...testOptionsRoot.querySelectorAll("input:checked")].map((input) => input.value);
}

function buildChoiceOrders(unitIds, seed, existingOrders = {}) {
  const orders = {};
  for (const id of unitIds) {
    const group = groups.find((item) => item.id === id);
    if (group.part < 3) continue;
    for (const question of questionsFor(group)) {
      const key = questionKey(group.testId, question.number);
      const letters = Object.keys(question.choices);
      const savedOrder = existingOrders[key];
      const isValid = Array.isArray(savedOrder)
        && savedOrder.length === letters.length
        && savedOrder.every((letter) => letters.includes(letter))
        && new Set(savedOrder).size === letters.length;
      if (isValid) {
        orders[key] = savedOrder;
        continue;
      }
      const order = shuffled(letters, randomGenerator(`${seed}:choices:${key}`));
      if (order.every((letter, index) => letter === letters[index])) order.push(order.shift());
      orders[key] = order;
    }
  }
  return orders;
}

function buildSession(parts, tests) {
  const seed = `${Date.now()}-${Math.random()}`;
  const random = randomGenerator(seed);
  const unitIds = parts.sort((a, b) => a - b).flatMap((part) =>
    shuffled(groups.filter((group) => group.part === part && tests.includes(group.testId)), random).map((group) => group.id)
  );
  return {
    version: 4,
    seed,
    selectedParts: parts,
    selectedTests: tests,
    unitIds,
    currentIndex: 0,
    answers: {},
    checkedGroups: [],
    choiceOrders: buildChoiceOrders(unitIds, seed),
  };
}

function currentGroup() {
  const id = session.unitIds[session.currentIndex];
  return groups.find((group) => group.id === id);
}

function questionsFor(group) {
  const source = questionsByTest[group.testId];
  return group.questionNumbers.map((number) => source[number - 1]);
}

function choiceOrderFor(group, question) {
  const originalOrder = Object.keys(question.choices);
  if (group.part < 3) return originalOrder;
  return session.choiceOrders[questionKey(group.testId, question.number)] || originalOrder;
}

function displayLetterFor(group, question, originalLetter) {
  const index = choiceOrderFor(group, question).indexOf(originalLetter);
  return String.fromCharCode(65 + index);
}

function pageUrl(group, page) {
  const base = questionsByTest[group.testId][0];
  const pattern = base.pagePattern || `assets/${group.testId}/page-{page}.webp`;
  return `public/${pattern.replace("{page}", String(page).padStart(2, "0"))}`;
}

function contextHtml(group, questions) {
  if (group.part === 1) {
    return `<img class="photo" src="public/${escapeHtml(questions[0].asset)}" alt="Photograph">`;
  }
  if ((group.part === 3 || group.part === 4) && group.transcript) {
    return `<div class="transcript">${escapeHtml(group.transcript)}</div>
      <details class="context-pages"><summary>Xem trang đề/graphic gốc</summary>${group.contextPages.map((page) =>
        `<img src="${pageUrl(group, page)}" alt="${escapeHtml(group.testId)}, trang ${page}">`
      ).join("")}</details>`;
  }
  if (group.part === 6 || group.part === 7) {
    return `<div class="context-pages">${group.contextPages.map((page) =>
      `<img src="${pageUrl(group, page)}" alt="${escapeHtml(group.testId)}, trang ${page}">`
    ).join("")}</div>`;
  }
  return "";
}

function renderGroup() {
  const group = currentGroup();
  const questions = questionsFor(group);
  const revealAnswers = submitted || session.checkedGroups.includes(group.id);
  const testLabel = group.testId.replace("test-", "Test ");
  const range = group.sourceRange.from === group.sourceRange.to
    ? `Câu gốc ${group.sourceRange.from}`
    : `Câu gốc ${group.sourceRange.from}–${group.sourceRange.to}`;

  groupCard.innerHTML = `
    <div class="group-meta"><span>Part ${group.part} · ${escapeHtml(partNames[group.part])}</span><span>${testLabel} · ${range}</span></div>
    ${contextHtml(group, questions)}
    ${questions.map((question) => {
      const key = questionKey(group.testId, question.number);
      return `<section class="quiz-question">
        <h3><span class="source">${testLabel} · ${question.number}</span><br>${escapeHtml(question.text)}</h3>
        <div class="choices">${choiceOrderFor(group, question).map((originalLetter, index) => {
          const displayLetter = String.fromCharCode(65 + index);
          const text = question.choices[originalLetter];
          const checked = session.answers[key] === originalLetter ? "checked" : "";
          const resultClass = revealAnswers
            ? originalLetter === question.correctAnswer ? " correct" : checked ? " wrong" : ""
            : "";
          const visibleText = group.part === 2 ? "" : `<span>${escapeHtml(text)}</span>`;
          const resultMarker = revealAnswers && checked
            ? `<span class="result-marker ${originalLetter === question.correctAnswer ? "marker-correct" : "marker-wrong"}" aria-label="${originalLetter === question.correctAnswer ? "Đúng" : "Sai"}">${originalLetter === question.correctAnswer ? "✓" : "✕"}</span>`
            : "";
          return `<label class="choice${resultClass}${group.part === 2 ? " listening-choice" : ""}"><input type="radio" name="${key}" value="${originalLetter}" ${checked}><b>${displayLetter}</b>${visibleText}${resultMarker}</label>`;
        }).join("")}</div>${revealAnswers ? (() => {
          const selected = session.answers[key];
          const isCorrect = selected === question.correctAnswer;
          const status = isCorrect ? "Đúng" : selected ? "Sai" : "Chưa trả lời";
          const correctDisplayLetter = displayLetterFor(group, question, question.correctAnswer);
          return `<p class="answer-feedback ${isCorrect ? "feedback-correct" : "feedback-wrong"}"><strong>${status}.</strong> Đáp án đúng: <b>${correctDisplayLetter}</b> — ${escapeHtml(question.choices[question.correctAnswer])}</p>`;
        })() : ""}
      </section>`;
    }).join("")}`;

  groupCard.querySelectorAll('input[type="radio"]').forEach((input) => {
    input.disabled = revealAnswers;
    input.addEventListener("change", () => {
      session.answers[input.name] = input.value;
      saveSession();
      updateProgress();
    });
  });
  previousButton.disabled = session.currentIndex === 0;
  nextButton.disabled = false;
  nextButton.textContent = revealAnswers
    ? session.currentIndex === session.unitIds.length - 1 ? "Xem kết quả" : "Nhóm tiếp"
    : "Kiểm tra đáp án";
  updateProgress();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function totalQuestions() {
  return session.unitIds.reduce((sum, id) => {
    const group = groups.find((item) => item.id === id);
    return sum + group.questionNumbers.length;
  }, 0);
}

function updateProgress() {
  const total = totalQuestions();
  const answered = Object.keys(session.answers).length;
  progressLabel.textContent = `Nhóm ${session.currentIndex + 1}/${session.unitIds.length}`;
  answeredLabel.textContent = `${answered}/${total} câu đã làm`;
  progressBar.style.width = `${total ? answered / total * 100 : 0}%`;
}

function showRunner() {
  setup.hidden = true;
  results.hidden = true;
  runner.hidden = false;
  submitted = false;
  renderGroup();
}

function finishQuiz() {
  submitted = true;
  const breakdown = Object.fromEntries(session.selectedParts.map((part) => [part, { correct: 0, total: 0 }]));
  for (const id of session.unitIds) {
    const group = groups.find((item) => item.id === id);
    for (const question of questionsFor(group)) {
      const key = questionKey(group.testId, question.number);
      breakdown[group.part].total += 1;
      if (session.answers[key] === question.correctAnswer) breakdown[group.part].correct += 1;
    }
  }
  const correct = Object.values(breakdown).reduce((sum, item) => sum + item.correct, 0);
  const total = Object.values(breakdown).reduce((sum, item) => sum + item.total, 0);
  localStorage.removeItem(STORAGE_KEY);
  runner.hidden = true;
  results.hidden = false;
  results.innerHTML = `<p class="kicker">KẾT QUẢ</p><h2>Hoàn thành phiên ôn tập</h2>
    <div class="score">${correct}/${total}</div>
    <table class="breakdown"><thead><tr><th>Part</th><th>Đúng</th><th>Tổng</th></tr></thead><tbody>${
      Object.entries(breakdown).map(([part, item]) => `<tr><td>Part ${part}</td><td>${item.correct}</td><td>${item.total}</td></tr>`).join("")
    }</tbody></table>
    <div class="setup-actions"><button id="review-quiz" class="secondary" type="button">Xem lại đáp án</button><button id="new-quiz" type="button">Tạo quiz mới</button></div>`;
  document.querySelector("#review-quiz").addEventListener("click", () => {
    session.currentIndex = 0;
    results.hidden = true;
    runner.hidden = false;
    renderGroup();
  });
  document.querySelector("#new-quiz").addEventListener("click", () => {
    results.hidden = true;
    setup.hidden = false;
  });
}

function renderOptions() {
  testOptionsRoot.innerHTML = ["01", "02", "03"].map((id) =>
    `<label class="test-option"><input type="checkbox" value="test-${id}" checked><span><strong>Test ${Number(id)}</strong><small>200 câu · 7 Part</small></span></label>`
  ).join("");
  optionsRoot.innerHTML = Array.from({ length: 7 }, (_, index) => index + 1).map((part) => {
    const selectedGroups = groups.filter((group) => group.part === part);
    const count = selectedGroups.reduce((sum, group) => sum + group.questionNumbers.length, 0);
    const unitLabel = [3, 4, 6, 7].includes(part) ? `${selectedGroups.length} nhóm` : `${selectedGroups.length} câu đơn`;
    return `<label class="part-option"><input type="checkbox" value="${part}" ${part === 5 ? "checked" : ""}><span><strong>Part ${part} · ${partNames[part]}</strong><small>${unitLabel} · ${count} câu</small></span></label>`;
  }).join("");
  testOptionsRoot.querySelectorAll("input").forEach((input) => input.addEventListener("change", updateOptionCounts));
  resumeButton.hidden = !localStorage.getItem(STORAGE_KEY);
}

function updateOptionCounts() {
  const tests = selectedTests();
  optionsRoot.querySelectorAll("input").forEach((input) => {
    const part = Number(input.value);
    const selectedGroups = groups.filter((group) => group.part === part && tests.includes(group.testId));
    const count = selectedGroups.reduce((sum, group) => sum + group.questionNumbers.length, 0);
    const unitLabel = [3, 4, 6, 7].includes(part) ? `${selectedGroups.length} nhóm` : `${selectedGroups.length} câu đơn`;
    input.closest("label").querySelector("small").textContent = `${unitLabel} · ${count} câu`;
  });
}

startButton.addEventListener("click", () => {
  const parts = selectedParts();
  const tests = selectedTests();
  if (!tests.length) {
    errorRoot.textContent = "Hãy chọn ít nhất một Test.";
    errorRoot.hidden = false;
    return;
  }
  if (!parts.length) {
    errorRoot.textContent = "Hãy chọn ít nhất một Part.";
    errorRoot.hidden = false;
    return;
  }
  errorRoot.hidden = true;
  session = buildSession(parts, tests);
  saveSession();
  showRunner();
});

resumeButton.addEventListener("click", () => {
  session = JSON.parse(localStorage.getItem(STORAGE_KEY));
  session.checkedGroups ??= [];
  session.choiceOrders = buildChoiceOrders(session.unitIds, session.seed, session.choiceOrders);
  session.version = 4;
  saveSession();
  showRunner();
});

previousButton.addEventListener("click", () => {
  if (session.currentIndex > 0) {
    session.currentIndex -= 1;
    saveSession();
    renderGroup();
  }
});

nextButton.addEventListener("click", () => {
  const group = currentGroup();
  if (!session.checkedGroups.includes(group.id)) {
    const allCorrect = questionsFor(group).every((question) =>
      session.answers[questionKey(group.testId, question.number)] === question.correctAnswer
    );
    session.checkedGroups.push(group.id);
    saveSession();
    void playFeedbackSound(allCorrect);
    renderGroup();
    if (allCorrect) {
      previousButton.disabled = true;
      nextButton.disabled = true;
      nextButton.textContent = session.currentIndex === session.unitIds.length - 1
        ? "Đang hoàn thành…"
        : "Đang chuyển…";
      const checkedGroupId = group.id;
      window.setTimeout(() => {
        if (currentGroup().id !== checkedGroupId) return;
        if (session.currentIndex < session.unitIds.length - 1) {
          session.currentIndex += 1;
          saveSession();
          renderGroup();
        } else {
          finishQuiz();
        }
      }, AUTO_ADVANCE_DELAY);
    }
  } else if (session.currentIndex < session.unitIds.length - 1) {
    session.currentIndex += 1;
    saveSession();
    renderGroup();
  } else {
    finishQuiz();
  }
});

const [groupData, ...testData] = await Promise.all([
  fetch("data/quiz-groups.json").then((response) => response.json()),
  ...["01", "02", "03"].map((id) => fetch(`data/test-${id}-structured.json`).then((response) => response.json())),
]);
groups = groupData.groups;
questionsByTest = Object.fromEntries(testData.map((data) => [data.id, data.questions.map((question) => ({ ...question, pagePattern: data.pagePattern }))]));
renderOptions();

const requestedParts = new URLSearchParams(window.location.search).get("parts");
const requestedTests = new URLSearchParams(window.location.search).get("tests");
if (requestedTests) {
  const tests = requestedTests.split(",").map((test) => `test-${test.padStart(2, "0")}`).filter((test) => questionsByTest[test]);
  testOptionsRoot.querySelectorAll("input").forEach((input) => {
    input.checked = tests.includes(input.value);
  });
  updateOptionCounts();
}
if (requestedParts) {
  const parts = requestedParts.split(",").map(Number).filter((part) => part >= 1 && part <= 7);
  optionsRoot.querySelectorAll("input").forEach((input) => {
    input.checked = parts.includes(Number(input.value));
  });
  if (parts.length) startButton.click();
}

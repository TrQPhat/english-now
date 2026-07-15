const setup = document.querySelector("#setup");
const runner = document.querySelector("#runner");
const results = document.querySelector("#results");
const optionsRoot = document.querySelector("#part-options");
const startButton = document.querySelector("#start");
const resumeButton = document.querySelector("#resume");
const finishButton = document.querySelector("#finish");
const previousButton = document.querySelector("#previous");
const nextButton = document.querySelector("#next");
const groupCard = document.querySelector("#group-card");
const progressLabel = document.querySelector("#progress-label");
const answeredLabel = document.querySelector("#answered-label");
const progressBar = document.querySelector("#progress-bar");
const errorRoot = document.querySelector("#setup-error");

const STORAGE_KEY = "toeic:mixed-quiz";
const partNames = {
  1: "Photographs", 2: "Question–Response", 3: "Conversations",
  4: "Talks", 5: "Incomplete Sentences", 6: "Text Completion", 7: "Reading",
};

let groups = [];
let questionsByTest = {};
let session = null;
let submitted = false;

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

function buildSession(parts) {
  const seed = `${Date.now()}-${Math.random()}`;
  const random = randomGenerator(seed);
  const unitIds = parts.sort((a, b) => a - b).flatMap((part) =>
    shuffled(groups.filter((group) => group.part === part), random).map((group) => group.id)
  );
  return { version: 2, seed, selectedParts: parts, unitIds, currentIndex: 0, answers: {}, checkedGroups: [] };
}

function currentGroup() {
  const id = session.unitIds[session.currentIndex];
  return groups.find((group) => group.id === id);
}

function questionsFor(group) {
  const source = questionsByTest[group.testId];
  return group.questionNumbers.map((number) => source[number - 1]);
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
        <div class="choices">${Object.entries(question.choices).map(([letter, text]) => {
          const checked = session.answers[key] === letter ? "checked" : "";
          const resultClass = revealAnswers
            ? letter === question.correctAnswer ? " correct" : checked ? " wrong" : ""
            : "";
          const visibleText = group.part === 2 ? "" : `<span>${escapeHtml(text)}</span>`;
          return `<label class="choice${resultClass}${group.part === 2 ? " listening-choice" : ""}"><input type="radio" name="${key}" value="${letter}" ${checked}><b>${letter}</b>${visibleText}</label>`;
        }).join("")}</div>${revealAnswers ? (() => {
          const selected = session.answers[key];
          const isCorrect = selected === question.correctAnswer;
          const status = isCorrect ? "Đúng" : selected ? "Sai" : "Chưa trả lời";
          return `<p class="answer-feedback ${isCorrect ? "feedback-correct" : "feedback-wrong"}"><strong>${status}.</strong> Đáp án đúng: <b>${question.correctAnswer}</b> — ${escapeHtml(question.choices[question.correctAnswer])}</p>`;
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
  finishButton.hidden = false;
  finishButton.textContent = "Nộp bài";
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
  finishButton.hidden = true;
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
    finishButton.hidden = false;
    finishButton.textContent = "Xem kết quả";
    renderGroup();
  });
  document.querySelector("#new-quiz").addEventListener("click", () => {
    results.hidden = true;
    setup.hidden = false;
  });
}

function renderOptions() {
  optionsRoot.innerHTML = Array.from({ length: 7 }, (_, index) => index + 1).map((part) => {
    const selectedGroups = groups.filter((group) => group.part === part);
    const count = selectedGroups.reduce((sum, group) => sum + group.questionNumbers.length, 0);
    const unitLabel = [3, 4, 6, 7].includes(part) ? `${selectedGroups.length} nhóm` : `${selectedGroups.length} câu đơn`;
    return `<label class="part-option"><input type="checkbox" value="${part}" ${part === 5 ? "checked" : ""}><span><strong>Part ${part} · ${partNames[part]}</strong><small>${unitLabel} · ${count} câu</small></span></label>`;
  }).join("");
  resumeButton.hidden = !localStorage.getItem(STORAGE_KEY);
}

startButton.addEventListener("click", () => {
  const parts = selectedParts();
  if (!parts.length) {
    errorRoot.hidden = false;
    return;
  }
  errorRoot.hidden = true;
  session = buildSession(parts);
  saveSession();
  showRunner();
});

resumeButton.addEventListener("click", () => {
  session = JSON.parse(localStorage.getItem(STORAGE_KEY));
  session.checkedGroups ??= [];
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
    session.checkedGroups.push(group.id);
    saveSession();
    renderGroup();
  } else if (session.currentIndex < session.unitIds.length - 1) {
    session.currentIndex += 1;
    saveSession();
    renderGroup();
  } else {
    finishQuiz();
  }
});

finishButton.addEventListener("click", () => {
  if (submitted) {
    runner.hidden = true;
    results.hidden = false;
    finishButton.hidden = true;
  } else if (window.confirm("Nộp bài và xem kết quả phiên ôn tập?")) {
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
if (requestedParts) {
  const parts = requestedParts.split(",").map(Number).filter((part) => part >= 1 && part <= 7);
  optionsRoot.querySelectorAll("input").forEach((input) => {
    input.checked = parts.includes(Number(input.value));
  });
  if (parts.length) startButton.click();
}

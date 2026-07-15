const picker = document.querySelector("#test-picker");
const contentRoot = document.querySelector("#pages");
const answersRoot = document.querySelector("#answers");
const countRoot = document.querySelector("#answered-count");
const resultRoot = document.querySelector("#result");
const submitButton = document.querySelector("#submit");

const availableTests = ["test-01", "test-02", "test-03"];
let quiz;
let selected = {};
let currentQuestion = 1;
let submitted = false;

function compactAnswers(data) {
  return Object.fromEntries(data.parts.flatMap((part) => {
    const answers = part.answers.replaceAll(" ", "");
    return [...answers].map((answer, index) => [part.from + index, answer]);
  }));
}

function correctAnswers() {
  return quiz.questions
    ? Object.fromEntries(quiz.questions.map((question) => [question.number, question.correctAnswer]))
    : compactAnswers(quiz);
}

function assetUrl(path) {
  return `public/${path}`;
}

function pageUrl(page) {
  const width = String(quiz.pageCount || 45).length;
  return assetUrl(quiz.pagePattern.replace("{page}", String(page).padStart(width, "0")));
}

function save() {
  localStorage.setItem(`toeic:${quiz.id}`, JSON.stringify(selected));
  countRoot.textContent = Object.keys(selected).length;
}

function renderQuestion() {
  const question = quiz.questions[currentQuestion - 1];
  const context = question.asset
    ? `<img class="question-asset" src="${assetUrl(question.asset)}" alt="Hình cho câu ${question.number}">`
    : `<details class="source-page"><summary>Xem passage/trang đề gốc</summary>${question.contextPages.map((page) => `<img src="${pageUrl(page)}" alt="Trang ${page}">`).join("")}</details>`;
  const choices = Object.entries(question.choices).map(([letter, text]) => {
    const checked = selected[question.number] === letter ? "checked" : "";
    const verdict = submitted
      ? letter === question.correctAnswer ? " is-correct" : checked ? " is-wrong" : ""
      : "";
    return `<label class="question-choice${verdict}"><input type="radio" name="current-answer" value="${letter}" ${checked}><b>${letter}</b><span>${text}</span></label>`;
  }).join("");

  contentRoot.innerHTML = `<article class="question-card">
    <div class="question-meta"><span>Part ${question.part}</span><span>Câu ${question.number}/200</span></div>
    ${context}
    <h2>${question.text}</h2>
    <div class="question-choices">${choices}</div>
    <nav class="question-actions">
      <button class="secondary" data-move="-1" ${question.number === 1 ? "disabled" : ""}>Câu trước</button>
      <button data-move="1" ${question.number === 200 ? "disabled" : ""}>Câu tiếp</button>
    </nav>
  </article>`;

  contentRoot.querySelectorAll('input[name="current-answer"]').forEach((input) => {
    input.addEventListener("change", () => {
      selected[question.number] = input.value;
      save();
      renderNavigator();
    });
  });
  contentRoot.querySelectorAll("[data-move]").forEach((button) => {
    button.addEventListener("click", () => {
      currentQuestion += Number(button.dataset.move);
      renderQuestion();
      renderNavigator();
      document.querySelector(".paper").scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function renderNavigator() {
  if (!quiz.questions) return;
  const correct = correctAnswers();
  answersRoot.innerHTML = quiz.parts.map((part) => `<section class="part"><h2>Part ${part.id}</h2><div class="number-grid">${
    Array.from({ length: part.to - part.from + 1 }, (_, index) => {
      const number = part.from + index;
      const state = submitted
        ? selected[number] === correct[number] ? " correct" : selected[number] ? " wrong" : ""
        : selected[number] ? " answered" : "";
      return `<button class="number${state}${number === currentQuestion ? " active" : ""}" data-question="${number}">${number}</button>`;
    }).join("")
  }</div></section>`).join("");
  answersRoot.querySelectorAll("[data-question]").forEach((button) => {
    button.addEventListener("click", () => {
      currentQuestion = Number(button.dataset.question);
      renderQuestion();
      renderNavigator();
    });
  });
}

function renderLegacyPages() {
  const width = String(quiz.pageCount).length;
  const pages = Array.from({ length: quiz.pageCount }, (_, index) =>
    quiz.pagePattern.replace("{page}", String(index + 1).padStart(width, "0"))
  );
  contentRoot.innerHTML = pages.map((source, index) => `<img src="${assetUrl(source)}" alt="${quiz.title}, trang ${index + 1}" loading="${index < 2 ? "eager" : "lazy"}">`).join("");
  answersRoot.innerHTML = `<p class="conversion-note">Test này đang dùng chế độ nguyên trang và sẽ được chuyển sang từng câu sau khi Test 01 được đối chiếu hoàn tất.</p>`;
}

async function loadQuiz(id) {
  const base = await fetch(`data/${id}.json`).then((response) => response.json());
  const structured = await fetch(`data/${id}-structured.json`).then((response) => response.json());
  quiz = { ...base, ...structured, parts: base.parts };
  selected = JSON.parse(localStorage.getItem(`toeic:${id}`) || "{}");
  currentQuestion = 1;
  submitted = false;
  resultRoot.hidden = true;
  quiz.questions ? (renderQuestion(), renderNavigator()) : renderLegacyPages();
  save();
}

submitButton.addEventListener("click", () => {
  if (!quiz.questions) return;
  submitted = true;
  const correct = correctAnswers();
  const score = Object.entries(correct).filter(([number, answer]) => selected[number] === answer).length;
  const wrong = Object.entries(selected).filter(([number, answer]) => correct[number] !== answer).length;
  resultRoot.innerHTML = `<strong>${score}/200 câu đúng</strong><span>${wrong} câu sai · ${200 - Object.keys(selected).length} câu chưa làm</span>`;
  resultRoot.hidden = false;
  renderQuestion();
  renderNavigator();
});

for (const id of availableTests) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = id.replace("test-", "Test ");
  picker.append(option);
}
picker.addEventListener("change", () => loadQuiz(picker.value));
loadQuiz(availableTests[0]);

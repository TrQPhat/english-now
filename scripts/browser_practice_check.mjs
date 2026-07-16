const cdpPort = process.env.CDP_PORT || "9222";
const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`).then((response) => response.json());
const targetParts = process.env.TARGET_PARTS;
const practicePages = pages.filter((item) => {
  if (item.type !== "page") return false;
  const pathname = new URL(item.url).pathname;
  return pathname.endsWith("/practice.html") || pathname.endsWith("/practice");
});
const page = practicePages.find((item) => !targetParts || new URL(item.url).searchParams.get("parts") === targetParts) || practicePages[0];
if (!page) throw new Error("Practice page was not found in Edge debugging targets");
const selectedParts = new URL(page.url).searchParams.get("parts")?.split(",").map(Number) || [];

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression, userGesture = false) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

for (let attempt = 0; attempt < 30; attempt += 1) {
  if (await evaluate("document.querySelectorAll('.choice').length")) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!await evaluate("document.querySelector('.quiz-question')")) {
  const bodyText = await evaluate("document.body.innerText");
  throw new Error(`Quiz did not render. Body: ${bodyText}`);
}

const labels = await evaluate("[...document.querySelector('.quiz-question').querySelectorAll('.choice b')].map(item => item.innerText.trim())");
const expectedLabels = selectedParts[0] === 2 ? "ABC" : "ABCD";
if (labels.join("") !== expectedLabels) throw new Error(`Unexpected choice labels: ${JSON.stringify(labels)}`);
if (selectedParts[0] === 2) {
  const visibleChoiceText = await evaluate("document.querySelectorAll('.choice > span:not(.result-marker)').length");
  if (visibleChoiceText) throw new Error("Part 2 leaked answer text");
}
const removedControls = await evaluate("Boolean(document.querySelector('#sound-toggle, #finish'))");
if (removedControls) throw new Error("Removed sound or submit control is still rendered");
const translationsBeforeCheck = await evaluate("document.querySelectorAll('.translation-details').length");
if (translationsBeforeCheck) throw new Error("Translations must remain hidden before checking answers");
const translationsAvailable = await evaluate("fetch('data/translations/test-01-vi.json').then(response => response.ok).catch(() => false)");

const choiceOrderAudit = await evaluate(`(async () => {
  const storedSession = JSON.parse(localStorage.getItem('toeic:mixed-quiz'));
  const entries = Object.entries(storedSession.choiceOrders || {});
  if (!entries.length) return { count: 0, valid: true, allChanged: true };
  const tests = await Promise.all(['01', '02', '03'].map(id =>
    fetch(\`data/test-\${id}-structured.json\`).then(response => response.json())
  ));
  const questions = Object.fromEntries(tests.flatMap(test =>
    test.questions.map(question => [\`\${test.id}-question-\${question.number}\`, question])
  ));
  return {
    count: entries.length,
    valid: entries.every(([key, order]) => {
      const letters = Object.keys(questions[key].choices);
      return order.length === letters.length && new Set(order).size === letters.length
        && order.every(letter => letters.includes(letter));
    }),
    allChanged: entries.every(([key, order]) => {
      const letters = Object.keys(questions[key].choices);
      return order.some((letter, index) => letter !== letters[index]);
    }),
  };
})()`);
if (!choiceOrderAudit.valid || !choiceOrderAudit.allChanged) {
  throw new Error(`Invalid choice-order audit: ${JSON.stringify(choiceOrderAudit)}`);
}
if (selectedParts.some((part) => part >= 3) && !choiceOrderAudit.count) {
  throw new Error("Parts 3-7 did not create shuffled choice orders");
}
if (selectedParts.every((part) => part < 3) && choiceOrderAudit.count) {
  throw new Error("Parts 1-2 should retain their original choice order");
}

if (process.env.REAL_AUDIO === "1") {
  await evaluate(`window.__toneCount = 0; window.__audioContexts = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.__audioContexts.push(this); }
      createOscillator() {
        const oscillator = super.createOscillator();
        const nativeStart = oscillator.start.bind(oscillator);
        oscillator.start = (...args) => { window.__toneCount += 1; return nativeStart(...args); };
        return oscillator;
      }
    }; true`);
} else {
  await evaluate(`window.__toneCount = 0; window.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() {}
    createOscillator() { return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect(target) { return target; }, start() { window.__toneCount += 1; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return this; } }; }
  }; true`);
}
const initialProgress = await evaluate("document.querySelector('#progress-label').innerText");
const correctDisplayLetters = await evaluate(`(async () => {
  const sections = [...document.querySelectorAll('.quiz-question')];
  const displayLetters = [];
  for (const section of sections) {
    const source = section.querySelector('.source').innerText.split('·').map(value => value.trim());
    const testId = source[0].match(/\\d+/)[0].padStart(2, '0');
    const number = Number(source[1]);
    const data = await fetch(\`data/test-\${testId}-structured.json\`).then(response => response.json());
    const correctAnswer = data.questions.find(question => question.number === number).correctAnswer;
    const input = section.querySelector(\`.choice input[value="\${correctAnswer}"]\`);
    displayLetters.push(input.closest('.choice').querySelector('b').innerText);
    input.click();
  }
  document.querySelector('#next').click();
  return displayLetters;
})()`, true);
await new Promise((resolve) => setTimeout(resolve, 300));
const feedback = await evaluate("[...document.querySelectorAll('.answer-feedback')].map(item => item.innerText)");
const nextLabel = await evaluate("document.querySelector('#next').innerText");
const disabled = await evaluate("[...document.querySelectorAll('.choice input')].every(item => item.disabled)");
const toneCount = await evaluate("window.__toneCount");
const audioStates = process.env.REAL_AUDIO === "1"
  ? await evaluate("window.__audioContexts.map(context => context.state)")
  : [];

if (!feedback.every((text, index) => text.includes(`Đáp án đúng: ${correctDisplayLetters[index]}`))) {
  throw new Error(`Feedback/display mapping is wrong: ${JSON.stringify(feedback)}`);
}
const translationState = translationsAvailable ? await evaluate(`(async () => {
  const details = [...document.querySelectorAll('.translation-details')];
  const initiallyClosed = details.every(item => !item.open);
  const firstSection = document.querySelector('.quiz-question');
  const source = firstSection.querySelector('.source').innerText.split('·').map(value => value.trim());
  const testId = source[0].match(/\\d+/)[0].padStart(2, '0');
  const number = Number(source[1]);
  const data = await fetch(\`data/translations/test-\${testId}-vi.json\`).then(response => response.json());
  const translated = data.questions.find(question => question.number === number);
  const summary = firstSection.querySelector('.translation-details summary');
  summary.click();
  const expanded = summary.parentElement.open;
  const originalLetters = [...firstSection.querySelectorAll('.choice input')].map(input => input.value);
  const rows = [...firstSection.querySelectorAll('.translation-choice')];
  const mapped = rows.every((row, index) =>
    row.querySelector('b').innerText === String.fromCharCode(65 + index)
      && row.querySelector('span').innerText === translated.choices[originalLetters[index]]
  );
  const questionMapped = firstSection.querySelector('.translation-content > p').innerText === translated.text;
  summary.click();
  const collapsed = !summary.parentElement.open;
  return { count: details.length, initiallyClosed, mapped, questionMapped, expanded, collapsed };
})()`) : { count: 0, initiallyClosed: true, mapped: true, questionMapped: true, expanded: true, collapsed: true };
if (translationsAvailable && (translationState.count !== feedback.length || Object.values(translationState).some((value) => value === false))) {
  throw new Error(`Translation UI/mapping failed: ${JSON.stringify(translationState)}`);
}
if (!translationsAvailable && await evaluate("document.querySelectorAll('.translation-details').length")) {
  throw new Error("Translation UI should stay hidden when translation data is rolled back");
}
if (nextLabel !== "Đang chuyển…") throw new Error(`Unexpected next label: ${nextLabel}`);
if (!disabled) throw new Error("Answers remain editable after checking");
if (toneCount !== 3) throw new Error(`Correct feedback should play three tones, got ${toneCount}`);
if (process.env.REAL_AUDIO === "1" && !audioStates.includes("running")) {
  throw new Error(`AudioContext did not enter running state: ${audioStates.join(',')}`);
}

await new Promise((resolve) => setTimeout(resolve, 800));
const advancedProgress = await evaluate("document.querySelector('#progress-label').innerText");
if (advancedProgress === initialProgress) throw new Error("Correct answer did not auto-advance");
const contextsBeforeWake = process.env.REAL_AUDIO === "1"
  ? await evaluate("window.__audioContexts.length")
  : 0;
await evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); true");
await new Promise((resolve) => setTimeout(resolve, 50));

await evaluate(`(async () => {
  const source = document.querySelector('.source').innerText.split('·').map(value => value.trim());
  const testId = source[0].match(/\\d+/)[0].padStart(2, '0');
  const number = Number(source[1]);
  const data = await fetch(\`data/test-\${testId}-structured.json\`).then(response => response.json());
  const correctAnswer = data.questions.find(question => question.number === number).correctAnswer;
  const wrongAnswer = [...document.querySelectorAll('.choice input')].map(input => input.value).find(letter => letter !== correctAnswer);
  document.querySelector(\`.choice input[value="\${wrongAnswer}"]\`).click();
  document.querySelector('#next').click();
  return true;
})()`, true);
await new Promise((resolve) => setTimeout(resolve, 400));
const wrongFeedback = await evaluate("document.querySelector('.answer-feedback')?.innerText || ''");
const wrongProgress = await evaluate("document.querySelector('#progress-label').innerText");
const finalToneCount = await evaluate("window.__toneCount");
const contextsAfterWake = process.env.REAL_AUDIO === "1"
  ? await evaluate("window.__audioContexts.length")
  : 0;
const finalAudioState = process.env.REAL_AUDIO === "1"
  ? await evaluate("window.__audioContexts.at(-1).state")
  : "mock";
if (!wrongFeedback.startsWith("Sai.")) throw new Error(`Wrong feedback is missing: ${wrongFeedback}`);
if (wrongProgress !== advancedProgress) throw new Error("Wrong answer should remain on the current group");
if (finalToneCount !== toneCount + 1) throw new Error("Wrong feedback should play one warning tone");
if (process.env.REAL_AUDIO === "1" && (contextsAfterWake !== contextsBeforeWake + 1 || finalAudioState !== "running")) {
  throw new Error(`Audio context was not recreated after wake: ${contextsBeforeWake}->${contextsAfterWake}, ${finalAudioState}`);
}

const ordersBeforeReload = await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('toeic:mixed-quiz')).choiceOrders)");
await evaluate("history.replaceState({}, '', '/practice'); true");
await command("Page.reload");
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    if (await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#resume'))")) break;
  } catch {
    // The execution context is briefly unavailable while the page reloads.
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
await evaluate("document.querySelector('#resume').click(); true", true);
for (let attempt = 0; attempt < 30; attempt += 1) {
  if (await evaluate("document.querySelectorAll('.choice').length")) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const ordersAfterReload = await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('toeic:mixed-quiz')).choiceOrders)");
if (ordersAfterReload !== ordersBeforeReload) throw new Error("Choice order changed after reloading and resuming the session");

console.log(`BROWSER_INTERACTION_OK labels=${labels.join('/')} orders=${choiceOrderAudit.count} translations=${translationState.count} expand=ok stable=reload wake=${contextsBeforeWake}->${contextsAfterWake} next=${nextLabel} progress=${initialProgress}->${advancedProgress} tones=${toneCount}+1 audio=${finalAudioState}`);
console.log(feedback[0]);
socket.close();

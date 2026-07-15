const cdpPort = process.env.CDP_PORT || "9222";
const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`).then((response) => response.json());
const practicePages = pages.filter((item) => {
  if (item.type !== "page") return false;
  const pathname = new URL(item.url).pathname;
  return pathname.endsWith("/practice.html") || pathname.endsWith("/practice");
});
const page = practicePages.find((item) => item.url.includes("parts=2")) || practicePages[0];
if (!page) throw new Error("Practice page was not found in Edge debugging targets");

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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

for (let attempt = 0; attempt < 30; attempt += 1) {
  if (await evaluate("document.querySelectorAll('.choice').length")) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const labels = await evaluate("[...document.querySelectorAll('.choice')].map(item => item.innerText.trim())");
if (labels.join("") !== "ABC") throw new Error(`Part 2 leaked answer text: ${JSON.stringify(labels)}`);
const removedControls = await evaluate("Boolean(document.querySelector('#sound-toggle, #finish'))");
if (removedControls) throw new Error("Removed sound or submit control is still rendered");

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
await evaluate(`(async () => {
  const number = Number(document.querySelector('.source').innerText.split('·').pop().trim());
  const data = await fetch('data/test-01-structured.json').then(response => response.json());
  const correctAnswer = data.questions.find(question => question.number === number).correctAnswer;
  document.querySelector(\`.choice input[value="\${correctAnswer}"]\`).click();
  document.querySelector('#next').click();
  return true;
})()`, true);
await new Promise((resolve) => setTimeout(resolve, 300));
const feedback = await evaluate("document.querySelector('.answer-feedback')?.innerText || ''");
const nextLabel = await evaluate("document.querySelector('#next').innerText");
const disabled = await evaluate("[...document.querySelectorAll('.choice input')].every(item => item.disabled)");
const toneCount = await evaluate("window.__toneCount");
const audioStates = process.env.REAL_AUDIO === "1"
  ? await evaluate("window.__audioContexts.map(context => context.state)")
  : [];

if (!feedback.includes("Đáp án đúng:")) throw new Error(`Feedback is missing: ${feedback}`);
if (nextLabel !== "Đang chuyển…") throw new Error(`Unexpected next label: ${nextLabel}`);
if (!disabled) throw new Error("Answers remain editable after checking");
if (toneCount !== 3) throw new Error(`Correct feedback should play three tones, got ${toneCount}`);
if (process.env.REAL_AUDIO === "1" && !audioStates.includes("running")) {
  throw new Error(`AudioContext did not enter running state: ${audioStates.join(',')}`);
}

await new Promise((resolve) => setTimeout(resolve, 800));
const advancedProgress = await evaluate("document.querySelector('#progress-label').innerText");
if (advancedProgress === initialProgress) throw new Error("Correct answer did not auto-advance");

await evaluate(`(async () => {
  const number = Number(document.querySelector('.source').innerText.split('·').pop().trim());
  const data = await fetch('data/test-01-structured.json').then(response => response.json());
  const correctAnswer = data.questions.find(question => question.number === number).correctAnswer;
  const wrongAnswer = ['A', 'B', 'C'].find(letter => letter !== correctAnswer);
  document.querySelector(\`.choice input[value="\${wrongAnswer}"]\`).click();
  document.querySelector('#next').click();
  return true;
})()`, true);
await new Promise((resolve) => setTimeout(resolve, 400));
const wrongFeedback = await evaluate("document.querySelector('.answer-feedback')?.innerText || ''");
const wrongProgress = await evaluate("document.querySelector('#progress-label').innerText");
const finalToneCount = await evaluate("window.__toneCount");
if (!wrongFeedback.startsWith("Sai.")) throw new Error(`Wrong feedback is missing: ${wrongFeedback}`);
if (wrongProgress !== advancedProgress) throw new Error("Wrong answer should remain on the current group");
if (finalToneCount !== toneCount + 1) throw new Error("Wrong feedback should play one warning tone");

console.log(`BROWSER_INTERACTION_OK labels=${labels.join('/')} next=${nextLabel} progress=${initialProgress}->${advancedProgress} tones=${toneCount}+1 audio=${audioStates.join('/') || 'mock'}`);
console.log(feedback);
socket.close();

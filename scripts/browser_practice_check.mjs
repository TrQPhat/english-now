const pages = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("practice.html"));
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

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

for (let attempt = 0; attempt < 30; attempt += 1) {
  if (await evaluate("document.querySelectorAll('.choice').length")) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const labels = await evaluate("[...document.querySelectorAll('.choice')].map(item => item.innerText.trim())");
if (labels.join("") !== "ABC") throw new Error(`Part 2 leaked answer text: ${JSON.stringify(labels)}`);

await evaluate("document.querySelector('.choice input').click(); document.querySelector('#next').click(); true");
const feedback = await evaluate("document.querySelector('.answer-feedback')?.innerText || ''");
const nextLabel = await evaluate("document.querySelector('#next').innerText");
const disabled = await evaluate("[...document.querySelectorAll('.choice input')].every(item => item.disabled)");

if (!feedback.includes("Đáp án đúng:")) throw new Error(`Feedback is missing: ${feedback}`);
if (nextLabel !== "Nhóm tiếp") throw new Error(`Unexpected next label: ${nextLabel}`);
if (!disabled) throw new Error("Answers remain editable after checking");

console.log(`BROWSER_INTERACTION_OK labels=${labels.join('/')} next=${nextLabel}`);
console.log(feedback);
socket.close();

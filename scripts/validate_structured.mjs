import { readFile, access } from "node:fs/promises";

const testIds = ["test-01", "test-02", "test-03"];
const allFailures = [];

for (const testId of testIds) {
  const base = JSON.parse(await readFile(`data/${testId}.json`, "utf8"));
  const data = JSON.parse(await readFile(`data/${testId}-structured.json`, "utf8"));
  const failures = [];
  const expectedChoices = (number) => number >= 7 && number <= 31 ? 3 : 4;

  if (data.questions.length !== 200) failures.push(`question count: ${data.questions.length}`);
  for (let number = 1; number <= 200; number += 1) {
    const question = data.questions[number - 1];
    if (question.number !== number) failures.push(`position ${number}: number ${question.number}`);
    if (!question.text.trim()) failures.push(`question ${number}: empty text`);
    const expectedLetters = number >= 7 && number <= 31 ? "ABC" : "ABCD";
    if (Object.keys(question.choices).join("") !== expectedLetters) {
      failures.push(`question ${number}: ${Object.keys(question.choices).length} choices`);
    }
    for (const [letter, text] of Object.entries(question.choices)) {
      if (!text.trim()) failures.push(`question ${number}: empty choice ${letter}`);
    }
    const combinedText = `${question.text} ${Object.values(question.choices).join(" ")}`;
    if (/GO ON TO THE NEXT PAGE|Actual Test \d+/i.test(combinedText)) {
      failures.push(`question ${number}: page footer leaked into content`);
    }
    if (!"ABCD".includes(question.correctAnswer)) failures.push(`question ${number}: invalid answer`);
    if (!question.contextPages?.length) failures.push(`question ${number}: no context page`);
    for (const page of question.contextPages || []) {
      if (page < 1 || page > base.pageCount) failures.push(`question ${number}: invalid page ${page}`);
    }
    if (question.asset) {
      try { await access(`public/${question.asset}`); }
      catch { failures.push(`question ${number}: missing ${question.asset}`); }
    }
  }

  if (failures.length) allFailures.push(...failures.map((failure) => `${testId}: ${failure}`));
  else console.log(`${testId}-structured.json: 200 complete questions checked`);
}

if (allFailures.length) {
  console.error(allFailures.join("\n"));
  process.exit(1);
}
console.log("Structured total: 600 questions checked");

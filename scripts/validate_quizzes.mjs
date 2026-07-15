import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";

const allowed = /^[ABCD]+$/;
const files = (await readdir("data")).filter((name) => /^test-\d{2}\.json$/.test(name));
let failures = 0;

for (const file of files) {
  const quiz = JSON.parse(await readFile(path.join("data", file), "utf8"));
  const seen = new Set();
  for (const part of quiz.parts) {
    const answers = part.answers.replaceAll(" ", "");
    const expected = part.to - part.from + 1;
    if (answers.length !== expected || !allowed.test(answers)) {
      console.error(`${file}: Part ${part.id} has ${answers.length}/${expected} valid answers`);
      failures += 1;
    }
    for (let number = part.from; number <= part.to; number += 1) {
      if (seen.has(number)) {
        console.error(`${file}: duplicate question ${number}`);
        failures += 1;
      }
      seen.add(number);
    }
  }
  if (seen.size !== 200 || ![...Array(200)].every((_, index) => seen.has(index + 1))) {
    console.error(`${file}: question coverage is incomplete (${seen.size}/200)`);
    failures += 1;
  }
  if (quiz.pagePattern) {
    const width = String(quiz.pageCount).length;
    for (let index = 1; index <= quiz.pageCount; index += 1) {
      const page = quiz.pagePattern.replace("{page}", String(index).padStart(width, "0"));
      try {
        await access(path.join("public", page));
      } catch {
        console.error(`${file}: missing public/${page}`);
        failures += 1;
      }
    }
  }
  console.log(`${file}: checked ${seen.size} questions`);
}

if (failures) process.exit(1);

import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile("data/quiz-groups.json", "utf8"));
const expectedGroups = { 1: 18, 2: 75, 3: 39, 4: 30, 5: 90, 6: 12, 7: 45 };
const expectedQuestions = { 1: 18, 2: 75, 3: 117, 4: 90, 5: 90, 6: 48, 7: 162 };
const failures = [];
const ids = new Set();
const questionIds = new Set();

for (const group of data.groups) {
  if (ids.has(group.id)) failures.push(`duplicate group ${group.id}`);
  ids.add(group.id);
  if (!group.questionNumbers.length) failures.push(`empty group ${group.id}`);
  if ([3, 4].includes(group.part) && !group.transcript.trim()) failures.push(`missing transcript ${group.id}`);
  if ([3, 4].includes(group.part) && group.questionNumbers.length !== 3) failures.push(`invalid listening group ${group.id}`);
  if (group.part === 6 && group.questionNumbers.length !== 4) failures.push(`invalid Part 6 group ${group.id}`);
  for (const number of group.questionNumbers) {
    const id = `${group.testId}-${number}`;
    if (questionIds.has(id)) failures.push(`question grouped twice: ${id}`);
    questionIds.add(id);
  }
}

for (let part = 1; part <= 7; part += 1) {
  const selected = data.groups.filter((group) => group.part === part);
  const questions = selected.reduce((sum, group) => sum + group.questionNumbers.length, 0);
  if (selected.length !== expectedGroups[part]) failures.push(`Part ${part}: ${selected.length} groups`);
  if (questions !== expectedQuestions[part]) failures.push(`Part ${part}: ${questions} questions`);
}
if (questionIds.size !== 600) failures.push(`total questions: ${questionIds.size}`);
if (data.groups.length !== 309) failures.push(`total groups: ${data.groups.length}`);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("quiz-groups.json: 309 units / 600 unique questions checked");

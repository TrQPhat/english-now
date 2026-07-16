import fs from "node:fs";

const testIds = ["01", "02", "03"];
const forbiddenArtifacts = [
  /\bPART\s*[3467]\b/i,
  /end of the Listening test/i,
  /Turn to Part 5/i,
  /Stop!/i,
  /phần cuối của bài thi nghe/i,
  /chuyển sang Phần 5/i,
  /PHẦN trang/i,
];
let totalQuestions = 0;
let totalChoices = 0;
let failed = false;

function blankCount(value) {
  return (String(value).match(/_____/g) || []).length;
}

for (const id of testIds) {
  const sourcePath = `data/test-${id}-structured.json`;
  const translationPath = `data/translations/test-${id}-vi.json`;
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const translation = JSON.parse(fs.readFileSync(translationPath, "utf8"));
  const issues = [];

  if (translation.version !== 1) issues.push("version must be 1");
  if (translation.id !== source.id) issues.push(`id must be ${source.id}`);
  if (translation.language !== "vi") issues.push("language must be vi");
  if (translation.source !== sourcePath) issues.push(`source must be ${sourcePath}`);
  if (!Array.isArray(translation.questions) || translation.questions.length !== source.questions.length) {
    issues.push(`expected ${source.questions.length} translated questions`);
  }

  for (let index = 0; index < source.questions.length; index += 1) {
    const original = source.questions[index];
    const translated = translation.questions?.[index];
    if (!translated) continue;
    const label = `question ${original.number}`;
    if (translated.number !== original.number) issues.push(`${label}: number/order mismatch`);
    if (!translated.text?.trim()) issues.push(`${label}: empty translated text`);
    if (blankCount(translated.text) !== blankCount(original.text)) issues.push(`${label}: blank count changed`);

    const originalLetters = Object.keys(original.choices);
    const translatedLetters = Object.keys(translated.choices || {});
    if (translatedLetters.join("") !== originalLetters.join("")) {
      issues.push(`${label}: choice keys/order must be ${originalLetters.join("")}`);
      continue;
    }
    for (const letter of originalLetters) {
      const value = translated.choices[letter];
      if (!value?.trim()) issues.push(`${label}${letter}: empty translation`);
      if (blankCount(value) !== blankCount(original.choices[letter])) issues.push(`${label}${letter}: blank count changed`);
      if (forbiddenArtifacts.some((pattern) => pattern.test(value))) issues.push(`${label}${letter}: OCR/footer artifact remains`);
      totalChoices += 1;
    }
    if (forbiddenArtifacts.some((pattern) => pattern.test(translated.text))) issues.push(`${label}: OCR/footer artifact remains`);
    totalQuestions += 1;
  }

  if (issues.length) {
    failed = true;
    console.error(`${translationPath}: ${issues.length} issue(s)`);
    for (const issue of issues) console.error(`  - ${issue}`);
  } else {
    console.log(`${translationPath}: ${translation.questions.length} questions mapped correctly`);
  }
}

if (failed) process.exit(1);
console.log(`Translations total: ${totalQuestions} questions / ${totalChoices} choices checked`);

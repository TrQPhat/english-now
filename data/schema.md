# Quiz data schema

Each `test-xx.json` file contains:

- `id`, `title`, and `sourcePdf`: test identity and source provenance.
- `pageCount` and `pagePattern`: ordered page images containing the complete scanned test.
- `parts`: TOEIC part ranges and a compact answer string. Character position maps
  directly to the question number within the declared inclusive range.

Keeping answers split by part makes accidental shifts detectable during validation.

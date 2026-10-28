import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { REPO_ROOT } from "./repo-files.js";

const eslint = new ESLint({ cwd: fileURLToPath(REPO_ROOT) });
const PAGE_FILES = [
  "shared/page/example.js",
  "apps/mlb/page/js/example.js",
  "shared/page/html.js",
  "shared/page/show-last-drawn.js",
];

/**
 * The messages lint gives `code` as a page module at `filePath`, about hidden fields.
 * @param {string} code
 * @param {string} filePath
 */
async function listHiddenFieldMessages(code, filePath) {
  const [result] = await eslint.lintText(code, {
    filePath: fileURLToPath(new URL(filePath, REPO_ROOT)),
  });
  return result.messages.filter(({ message }) => message.includes("Hide a field visually"));
}

const HIDDEN_FIELDS = {
  "an input with hidden": 'const markup = `<input type="file" accept="image/*" hidden>`;',
  "a select with hidden, in plain text": "const markup = '<select hidden></select>';",
  "a textarea ending in hidden": 'const markup = `<textarea class="note" hidden/>`;',
  "a field hidden by assignment": "searchInput.hidden = true;",
  "a field hidden off an object": "parts.uploadField.hidden = true;",
  "a field hidden by its attribute": 'fileInput.setAttribute("hidden", "");',
  "a field hidden by its attribute off an object": 'this.photoPicker.setAttribute("hidden", "");',
  "a field hidden by a toggle": 'fileInput.toggleAttribute("hidden", true);',
  "a field named only input": "input.hidden = true;",
  "an input after a quoted value": 'const markup = `<input value="a > b" hidden>`;',
};

const SHOWN_FIELDS = {
  "a hidden button": 'const markup = `<button type="button" class="search-clear" hidden>`;',
  "a hidden section": 'const markup = `<section id="view" hidden>`;',
  "a hidden form value": 'const markup = `<input type="hidden" name="season" value="2026">`;',
  "an input whose words name hidden":
    'const markup = `<input placeholder="Show hidden-ball plays">`;',
  "an input whose quoted words hold hidden":
    'const markup = `<input placeholder="Show hidden plays">`;',
  "a sheet hidden by assignment": "sheet.hidden = true;",
  "a profile hidden by assignment": "profile.hidden = true;",
  "a sheet hidden off an object named for a field": "fieldSheet.hidden = true;",
  "a field's own value": "searchInput.value = '';",
};

for (const filePath of PAGE_FILES) {
  for (const [name, code] of Object.entries(HIDDEN_FIELDS))
    test(`lint rejects ${name} in ${filePath}`, async () => {
      assert.equal((await listHiddenFieldMessages(code, filePath)).length, 1);
    });

  for (const [name, code] of Object.entries(SHOWN_FIELDS))
    test(`lint lets ${name} pass in ${filePath}`, async () => {
      assert.deepEqual(await listHiddenFieldMessages(code, filePath), []);
    });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });
const PAGE_FILES = ["shared/page/example.js", "apps/mlb/page/js/example.js"];

/**
 * The messages lint gives `code` as a page module at `filePath`, about hidden fields.
 * @param {string} code
 * @param {string} filePath
 */
async function listHiddenFieldMessages(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter(({ message }) => message.includes("Hide a field visually"));
}

const HIDDEN_FIELDS = {
  "an input with hidden": 'const markup = `<input type="file" accept="image/*" hidden>`;',
  "a select with hidden, in plain text": "const markup = '<select hidden></select>';",
  "a textarea ending in hidden": 'const markup = `<textarea class="note" hidden/>`;',
  "a file input opened by click": "fileInput.click();",
  "a field opened by click off an object": "this.photoPicker.click();",
  "a field hidden by assignment": "searchInput.hidden = true;",
  "a field hidden off an object": "parts.uploadField.hidden = true;",
  "a field hidden by its attribute": 'fileInput.setAttribute("hidden", "");',
  "a field hidden by its attribute off an object": 'this.photoPicker.setAttribute("hidden", "");',
  "a field hidden by a toggle": 'fileInput.toggleAttribute("hidden", true);',
};

const SHOWN_FIELDS = {
  "a hidden button": 'const markup = `<button type="button" class="search-clear" hidden>`;',
  "a hidden section": 'const markup = `<section id="view" hidden>`;',
  "a hidden form value": 'const markup = `<input type="hidden" name="season" value="2026">`;',
  "an input whose words name hidden":
    'const markup = `<input placeholder="Show hidden-ball plays">`;',
  "a button's click": "findTapped(event)?.click();",
  "a sheet hidden by assignment": "sheet.hidden = true;",
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

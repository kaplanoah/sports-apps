import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { REPO_ROOT } from "./repo-files.js";

const eslint = new ESLint({ cwd: fileURLToPath(REPO_ROOT) });
const MESSAGE = "Call what the control's listener calls instead of faking a person's input.";

/**
 * The synthetic-input errors lint reports for `code` written in the page file at `filePath`.
 * @param {string} code
 * @param {string} filePath
 */
async function listSyntheticInputs(code, filePath) {
  const [result] = await eslint.lintText(code, {
    filePath: fileURLToPath(new URL(filePath, REPO_ROOT)),
  });
  return result.messages.filter((message) => message.message === MESSAGE);
}

const FAKED = [
  'document.querySelector("button").click();',
  ...[
    'new PointerEvent("pointerdown", { bubbles: true })',
    'new MouseEvent("click")',
    'new KeyboardEvent("keydown", { key: "Enter" })',
    'new TouchEvent("touchstart")',
    'new WheelEvent("wheel")',
    'new InputEvent("input")',
    'new FocusEvent("focus")',
    'new DragEvent("dragstart")',
    'new CompositionEvent("compositionstart")',
    ...[
      "cancel",
      "close",
      "submit",
      "reset",
      "input",
      "beforeinput",
      "change",
      "focus",
      "focusin",
      "focusout",
      "blur",
      "wheel",
      "contextmenu",
      "click",
      "dblclick",
      "auxclick",
      "drop",
      "drag",
      "dragstart",
      "compositionend",
      "pointerup",
      "mousedown",
      "keyup",
      "touchend",
    ].map((type) => `new Event("${type}")`),
  ].map((event) => `target.dispatchEvent(${event});`),
];

const KEPT = [
  'view.dispatchEvent(new Event("headerride"));',
  'list.dispatchEvent(new CustomEvent("reorder", { detail: [] }));',
  "page.click(target);",
];

for (const filePath of [
  "shared/page/example.js",
  "apps/mlb/page/js/example.js",
  "shared/page/html.js",
  "shared/page/show-last-drawn.js",
]) {
  for (const code of FAKED)
    test(`lint rejects faked input in ${filePath}: ${code}`, async () => {
      assert.equal((await listSyntheticInputs(code, filePath)).length, 1);
    });
  for (const code of KEPT)
    test(`lint allows ${code} in ${filePath}`, async () => {
      assert.deepEqual(await listSyntheticInputs(code, filePath), []);
    });
}

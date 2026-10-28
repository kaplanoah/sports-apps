// The gate an app's gate.html shows, at the page's own address, until the phone sends the access
// code. The Worker takes the code and keeps it in a cookie, so reloading opens the app.
import { trackKeyboardFocus } from "./keyboard-focus.js";
import { watchPresses } from "./press.js";
import { readWorkerError } from "./worker-error.js";

const PROBLEMS = {
  empty: "Type the code first",
  wrong_code: "That code isn't right. Check it and try again.",
  too_many_tries: "Too many tries. Try again in a minute.",
  unavailable: "Couldn't check the code. Check your connection and try again.",
};
const CHANGED_NOTE = "The code has changed. Ask whoever sent you the link for the new one.";
// Problems with what was typed outline the field; the others are no fault of the code.
const FIELD_PROBLEMS = new Set(["empty", "wrong_code"]);

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const codeField = /** @type {HTMLInputElement} */ (findElement("codeField"));
const message = findElement("gateMessage");

/** @param {string} text */
function showNote(text) {
  message.classList.add("is-calm");
  message.textContent = text;
}

/** @param {keyof typeof PROBLEMS} problem */
function showProblem(problem) {
  codeField.classList.toggle("is-wrong", FIELD_PROBLEMS.has(problem));
  message.classList.remove("is-calm");
  message.textContent = PROBLEMS[problem];
}

function clearProblem() {
  codeField.classList.remove("is-wrong");
  if (!message.classList.contains("is-calm")) message.textContent = "";
}

// A phone signed out by a new code learns why, rather than meeting a blank form.
async function showWhetherCodeChanged() {
  try {
    const response = await fetch("access", { cache: "no-store" });
    if (response.ok && (await response.json()).isChanged) showNote(CHANGED_NOTE);
  } catch {
    // The note only explains the gate, which works without it.
  }
}

/**
 * The problem with the code, or null once the Worker has taken it.
 * @param {string} code
 * @returns {Promise<keyof typeof PROBLEMS | null>}
 */
async function sendCode(code) {
  try {
    const response = await fetch("access", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (response.ok) return null;
    const body = await response.json().catch(() => null);
    const problem = readWorkerError(body, response.status).code;
    return Object.hasOwn(PROBLEMS, problem)
      ? /** @type {keyof typeof PROBLEMS} */ (problem)
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

function watchForm() {
  let isSending = false;
  codeField.addEventListener("input", clearProblem);
  findElement("gateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSending) return;
    if (!codeField.value.replace(/[\s-]/g, "")) {
      showProblem("empty");
      return;
    }
    isSending = true;
    const problem = await sendCode(codeField.value);
    isSending = false;
    if (problem) showProblem(problem);
    else location.reload();
  });
}

trackKeyboardFocus();
watchPresses();
watchForm();
showWhetherCodeChanged();

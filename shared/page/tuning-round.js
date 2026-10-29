// What a tuning round asks for and what its panel shows, outside production. A round names CSS
// custom properties set on :root, each with a slider's range and step, in a unit, or a list of
// values to pick from as buttons, and the panel sets each on the page as it's moved. Runs in the
// page and in Node, so it uses no DOM.

/**
 * @typedef {{ property: string, label: string, group?: string, min: number, max: number, step: number, unit: string, isVertical?: boolean }} SliderValue
 * @typedef {{ property: string, label: string, group?: string, options: string[] }} OptionValue
 * @typedef {SliderValue | OptionValue} RoundValue
 * @typedef {{ name: string, values: RoundValue[] }} Round
 * @typedef {Record<string, string>} RoundSettings each property's value, as CSS text
 */

/**
 * @param {unknown} value
 * @returns {value is number}
 */
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * Why a round's value can't be tuned, or null when it can.
 * @param {any} value
 */
function findValueProblem(value) {
  if (typeof value?.property !== "string" || !value.property.startsWith("--"))
    return "names no custom property, like --dot-lift";
  if (typeof value.label !== "string" || !value.label) return "has no label";
  if (value.group !== undefined && (typeof value.group !== "string" || !value.group))
    return "has an empty group or one that isn't text";
  if ("options" in value) {
    const isList =
      Array.isArray(value.options) &&
      value.options.length > 1 &&
      value.options.every((option) => typeof option === "string");
    return isList ? null : "lists fewer than two options, or one that isn't text";
  }
  if (![value.min, value.max, value.step].every(isFiniteNumber))
    return "needs a min, a max, and a step, each a number";
  if (value.min >= value.max) return "has a min that isn't below its max";
  if (value.step <= 0) return "has a step that isn't above 0";
  if (typeof value.unit !== "string") return 'needs a unit, like "px", or "" for none';
  if (value.isVertical !== undefined && typeof value.isVertical !== "boolean")
    return "needs isVertical to be a boolean";
  return null;
}

/**
 * The round a page holds, checked, so a mistake in it says what's wrong rather than drawing a
 * panel that sets nothing.
 * @param {string} text the round as JSON
 * @returns {Round}
 */
export function readRound(text) {
  const round = JSON.parse(text);
  if (typeof round?.name !== "string" || !round.name) throw new Error("The round has no name.");
  if (!Array.isArray(round.values) || !round.values.length)
    throw new Error("The round lists no values to tune.");
  const properties = new Set();
  for (const value of round.values) {
    const problem = findValueProblem(value);
    if (problem) throw new Error(`The round's ${value?.property ?? "value"} ${problem}.`);
    if (properties.has(value.property)) throw new Error(`The round lists ${value.property} twice.`);
    properties.add(value.property);
  }
  return round;
}

/**
 * @param {RoundValue} value
 * @returns {value is SliderValue}
 */
export const isSlider = (value) => !("options" in value);

/** @param {Round} round */
export const listGroups = (round) => [...new Set(round.values.flatMap(({ group }) => group ?? []))];

/** The CSS offset step matching an arrow's physical direction. @param {string} key */
export function findOffsetNudge(key) {
  if (["ArrowLeft", "ArrowDown"].includes(key)) return 1;
  if (["ArrowRight", "ArrowUp"].includes(key)) return -1;
  return null;
}

/** @param {number} number */
const countDecimals = (number) => String(number).split(".")[1]?.length ?? 0;

/**
 * The slider's number in a value's CSS text, or null when the text isn't a number in its unit.
 * @param {string} text
 * @param {SliderValue} slider
 */
export function readNumber(text, { unit }) {
  const match = text.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i);
  if (!match) return null;
  const isInUnit = match[2] === unit || (Number(match[1]) === 0 && !match[2]);
  return isInUnit ? Number(match[1]) : null;
}

/**
 * A number as CSS text in the slider's unit, held on the slider's steps, from its min to the last
 * step at or below its max.
 * @param {number} number
 * @param {SliderValue} slider
 */
export function writeNumber(number, { min, max, step, unit }) {
  // Rounded first, so a max that float division puts a hair under a step still reaches it.
  const lastStep = Math.floor(Number(((max - min) / step).toFixed(6)));
  const steps = Math.min(lastStep, Math.max(0, Math.round((number - min) / step)));
  const held = min + steps * step;
  const decimals = Math.max(countDecimals(min), countDecimals(step));
  return `${Number(held.toFixed(decimals))}${unit}`;
}

/**
 * The value a slider's arrow moves to, a step down or up.
 * @param {string} text
 * @param {SliderValue} slider
 * @param {-1 | 1} direction
 */
export function nudgeNumber(text, slider, direction) {
  const number = readNumber(text, slider) ?? slider.min;
  return writeNumber(number + direction * slider.step, slider);
}

/**
 * The values to show, each the one kept from before where the page's own starts are the same as
 * they were then, so a push that changes a start shows it rather than a value tuned from another.
 * @param {RoundSettings} starts each property's value as the page's stylesheets set it
 * @param {{ starts?: RoundSettings, values?: RoundSettings } | null} kept
 * @returns {RoundSettings}
 */
export function restoreSettings(starts, kept) {
  const isSameStart = Object.entries(starts).every(
    ([property, start]) => kept?.starts?.[property] === start,
  );
  if (!isSameStart || !kept?.values) return { ...starts };
  return Object.fromEntries(
    Object.keys(starts).map((property) => [property, kept.values?.[property] ?? starts[property]]),
  );
}

/**
 * Every value of the round as plain text, one line each, to paste back into a chat.
 * @param {Round} round
 * @param {RoundSettings} settings
 */
export const writeCopyText = (round, settings) =>
  [round.name, ...round.values.map(({ property }) => `${property}: ${settings[property]}`)].join(
    "\n",
  );

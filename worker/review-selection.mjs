/** @param {unknown} selection */
export const isLegacyReviewSelection = (selection) =>
  typeof selection === "string" &&
  /^[1-9]\d*$/.test(selection) &&
  Number.isSafeInteger(Number(selection));

/** @param {unknown} selection */
export const isReviewSelection = (selection) =>
  selection === "initial" ||
  isLegacyReviewSelection(selection) ||
  (typeof selection === "string" && /^node:[A-Za-z0-9_+/=-]{1,256}$/.test(selection));

// What a Contact report may hold, checked alike by the page's form and the Worker that takes it,
// so a report the form accepts is never refused for its size or fields.

// The route a page sends a report to, under the page's own address.
export const CONTACT_ROUTE = "contact";

export const CONTACT_CATEGORIES = [
  { key: "bug", name: "Bug report", label: "What happened, and what did you expect to happen?" },
  { key: "feature", name: "Feature request", label: "What would make the app better?" },
  { key: "other", name: "Something else", label: "Message" },
];

export const CONTACT_LIMITS = {
  message: 10000,
  email: 254,
  diagnostics: 100000,
  screenshot: 2 * 1024 * 1024,
  request: 3 * 1024 * 1024,
};

export const isContactEmail = (value) =>
  typeof value === "string" &&
  value.length <= CONTACT_LIMITS.email &&
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(
    value,
  );

/** @param {number} count */
const groupDigits = (count) => String(count).replace(/\B(?=(\d{3})+$)/g, ",");

/** @param {{ message: string, email: string }} draft */
export function validateContactFields({ message, email }) {
  if (!message.trim()) return { field: "message", text: "Enter a message" };
  if (message.length > CONTACT_LIMITS.message)
    return {
      field: "message",
      text: `Keep your message to ${groupDigits(CONTACT_LIMITS.message)} characters or fewer`,
    };
  if (email.trim() && !isContactEmail(email.trim()))
    return { field: "email", text: "Enter an email address like name@example.com" };
  return null;
}

/** @param {number[]} sizes */
const findLargest = (sizes) => sizes.indexOf(Math.max(...sizes));

// A report is its header, then blocks apart by a blank line, each a record or a log listing its
// newest lines first. One too long to send loses the oldest lines of whichever block is largest,
// so each log keeps its newest lines, and a block left with only its title goes.
/** @param {string} report */
export function fitContactDiagnostics(report) {
  if (report.length <= CONTACT_LIMITS.diagnostics) return report;
  const [header, ...blocks] = report.split("\n\n");
  const blockLines = blocks.map((block) => block.split("\n"));
  const sizes = blocks.map((block) => block.length);
  let excess = report.length - CONTACT_LIMITS.diagnostics;
  while (excess > 0 && blockLines.length) {
    const largest = findLargest(sizes);
    const lines = blockLines[largest];
    if (lines.length > 2) {
      const cut = /** @type {string} */ (lines.pop()).length + 1;
      sizes[largest] -= cut;
      excess -= cut;
    } else {
      excess -= sizes[largest] + 2;
      blockLines.splice(largest, 1);
      sizes.splice(largest, 1);
    }
  }
  return [header, ...blockLines.map((lines) => lines.join("\n"))].join("\n\n");
}

/** @param {{ type: string, size: number }} file */
export function validateContactScreenshot(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    return "Choose a PNG, JPEG, or WebP screenshot";
  if (!file.size) return "Choose a screenshot that isn't empty";
  if (file.size > CONTACT_LIMITS.screenshot)
    return `Choose a screenshot of ${CONTACT_LIMITS.screenshot / 1024 / 1024} MB or less`;
  return null;
}

// What a Contact report may hold, checked alike by the page's form and the Worker that takes it,
// so a report the form accepts is never refused for its size or fields.

// The route a page sends a report to, under the page's own address.
export const CONTACT_ROUTE = "contact";

export const CONTACT_CATEGORIES = [
  { key: "bug", name: "Bug report", label: "What happened?" },
  { key: "feature", name: "Feature request", label: "What would you like to add?" },
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

/** @param {{ type: string, size: number }} file */
export function validateContactScreenshot(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    return "Choose a PNG, JPEG, or WebP screenshot";
  if (!file.size) return "Choose a screenshot that isn't empty";
  if (file.size > CONTACT_LIMITS.screenshot)
    return `Choose a screenshot of ${CONTACT_LIMITS.screenshot / 1024 / 1024} MB or less`;
  return null;
}

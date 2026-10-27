export const CONTACT_CATEGORIES = [
  { key: "bug", name: "Bug report", label: "What happened, and what did you expect to happen?" },
  { key: "feature", name: "Feature request", label: "What would make the app better?" },
  { key: "other", name: "Something else", label: "Message" },
];

export const CONTACT_LIMITS = {
  message: 10000,
  diagnostics: 100000,
  screenshot: 2 * 1024 * 1024,
  request: 3 * 1024 * 1024,
};

export const isContactEmail = (value) =>
  typeof value === "string" &&
  value.length <= 254 &&
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(
    value,
  );

/** @param {{ message: string, email: string }} draft */
export function validateContactFields({ message, email }) {
  if (!message.trim()) return { field: "message", text: "Enter a message" };
  if (message.length > CONTACT_LIMITS.message)
    return { field: "message", text: "Keep your message under 10,000 characters" };
  if (email.trim() && !isContactEmail(email.trim()))
    return { field: "email", text: "Enter an email address like name@example.com" };
  return null;
}

/** @param {{ type: string, size: number }} file */
export function validateContactScreenshot(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    return "Choose a PNG, JPEG, or WebP screenshot";
  if (!file.size || file.size > CONTACT_LIMITS.screenshot) return "Choose a screenshot under 2 MB";
  return null;
}

import { matchPath } from "./harness.mjs";
import { readContactRequest } from "../../shared/worker/contact-request.js";

// Contact's address to show, and a send that the Worker's own check accepts, which arrives,
// fails, or waits as the test sets `delivery.mode`.
/** @param {import("@playwright/test").Page} page */
export async function serveContact(page) {
  const requests = [];
  const delivery = { mode: "success", finish: () => {} };
  await page.route(matchPath("/contact"), async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { email: "owner@example.com" } });
    const body = route.request().postDataJSON();
    await readContactRequest(
      new Request("https://example.com/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    requests.push(body);
    if (delivery.mode === "hold")
      await new Promise((resolve) => {
        delivery.finish = () => resolve(null);
      });
    if (delivery.mode === "failure") return route.abort("failed");
    return route.fulfill({ status: 202, json: { accepted: true, id: body.id } });
  });
  return { requests, delivery };
}

/** @param {import("@playwright/test").Page} page @param {string} [category] */
export async function openContact(page, category) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#contactBtn").click();
  const dialog = page.locator("#contactDialog");
  if (category) await dialog.getByRole("button", { name: category, exact: true }).click();
  return dialog;
}

/** @param {import("@playwright/test").Page} page */
async function closeContactView(page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

export const CONTACT_VIEWS = [
  {
    name: "Contact menu",
    open: (page) => openContact(page),
    shown: (page) => page.locator("#contactDialog .contact-menu"),
    close: closeContactView,
  },
  ...["Bug report", "Feature request", "Something else"].map((category) => ({
    name: category,
    open: (page) => openContact(page, category),
    shown: (page) => page.locator("#contactMessage"),
    close: closeContactView,
  })),
];

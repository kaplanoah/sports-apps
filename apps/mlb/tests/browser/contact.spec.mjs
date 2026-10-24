import { test, expect, openApp } from "./harness.mjs";
import { registerContactTests } from "../../../../tests/browser/contact.mjs";

registerContactTests({ test, expect, openApp, app: "mlb" });

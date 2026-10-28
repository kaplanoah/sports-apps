import { test, expect, openApp } from "./harness.mjs";
import { registerContactPressTests } from "../../../../tests/browser/contact-presses.mjs";

registerContactPressTests({ test, expect, openApp, app: "mlb" });

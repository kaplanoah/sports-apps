import { test, expect, openApp } from "./harness.mjs";
import { testContact } from "../../../../tests/browser/contact.mjs";

testContact(test, expect, { openApp, league: "MLB" });

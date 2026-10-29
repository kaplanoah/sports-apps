import { checkBracketPull } from "../../../../tests/browser/bracket-pull.mjs";
import { test, openApp } from "./harness.mjs";

checkBracketPull({ test, openApp, cards: "[data-series]", sideways: "#bracketWrap .bracket" });

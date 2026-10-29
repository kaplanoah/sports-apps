import { checkBracketPull } from "../../../../tests/browser/bracket-pull.mjs";
import { test, openApp } from "./harness.mjs";

checkBracketPull({ test, openApp, cards: ".box", sideways: "#bracketWrap .tree-scroll" });

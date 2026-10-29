import { test, expect, openApp } from "./harness.mjs";
import { testWordCentering } from "../../../../tests/browser/word-centering.mjs";

testWordCentering(test, expect, { openApp });

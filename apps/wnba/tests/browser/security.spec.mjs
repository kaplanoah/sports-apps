import { checkAppSecurity } from "../../../../tests/browser/security.mjs";
import { openApp, serveLockedApp } from "./harness.mjs";

checkAppSecurity("wnba", openApp, serveLockedApp);

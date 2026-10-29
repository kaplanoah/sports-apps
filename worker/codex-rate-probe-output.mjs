import { writeFileSync } from "node:fs";

export function writeRateProbeResult(value) {
  writeFileSync(1, JSON.stringify(value));
}

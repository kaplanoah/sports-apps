// Bounded aggregate identity evidence reads without association or storage changes.
import { isSameJson } from "../page/compare.js";
import { createIdentityLookup } from "./identity.js";

const PROBLEM_LIMIT = 50;
const SOURCE_LIMIT = 12;
const RECORD_LIMIT = 500;
const VENDORS = new Set(["espn", "mlb", "wnba", "balldontlie", "league"]);

async function readVendorEvidence(storage, policy, ids) {
  const records = new Map();
  const conflicts = new Set();
  if (!policy.vendorGameSourcePrefix || !policy.readSavedVendorGames)
    return { records, conflicts, limited: false };
  const sources = await storage.list({
    prefix: policy.vendorGameSourcePrefix,
    reverse: true,
    limit: SOURCE_LIMIT + 1,
  });
  let limited = sources.size > SOURCE_LIMIT;
  let remaining = RECORD_LIMIT;
  for (const [key, value] of [...sources].slice(0, SOURCE_LIMIT)) {
    if (!remaining) {
      limited = true;
      break;
    }
    const saved = policy.readSavedVendorGames(key, value, remaining);
    if (!saved) continue;
    limited ||= !!saved.truncated;
    remaining -= saved.records.length + saved.rejected;
    for (const record of saved.records) {
      if (!ids.has(record.id)) continue;
      const previous = records.get(record.id);
      if (previous && !isSameJson(previous, record)) conflicts.add(record.id);
      else records.set(record.id, record);
    }
  }
  return { records, conflicts, limited };
}

/**
 * @param {any} storage
 * @param {import("./identity-documents.js").IdentityPolicy} policy
 */
export async function readIdentityDiagnosis(storage, policy) {
  try {
    const { problems, truncated } = await createIdentityLookup(storage, policy.league).readProblems(
      PROBLEM_LIMIT,
    );
    const needsGames = problems.some(
      (problem) =>
        problem.vendor === "espn" && problem.type === "game" && problem.problem === "unmatched",
    );
    const evidence = needsGames
      ? await readVendorEvidence(storage, policy, new Set(problems.map((problem) => problem.id)))
      : null;
    const groups = new Map();
    for (const problem of problems) {
      let reason = problem.reason ?? "evidence_unavailable";
      if (problem.problem === "disputed") reason = "disputed_association";
      else if (problem.vendor === "espn" && problem.type === "game") {
        const record = evidence?.records.get(problem.id);
        if (evidence?.conflicts.has(problem.id)) reason = "conflicting_retained_evidence";
        else if (record && (!record.away || !record.home)) reason = "missing_team_evidence";
        else if (record && !record.start) reason = "missing_date_evidence";
        else if (evidence?.limited) reason = "evidence_limited";
        else if (!record) reason = "evidence_unavailable";
        else reason = "unclassified";
      }
      const group = {
        vendor: VENDORS.has(problem.vendor) ? problem.vendor : "other",
        type: problem.type === "game" || problem.type === "player" ? problem.type : "other",
        problem: problem.problem ?? "other",
        reason,
      };
      const key = JSON.stringify(group);
      const previous = groups.get(key);
      groups.set(key, { ...group, count: (previous?.count ?? 0) + 1 });
    }
    return {
      available: true,
      sampled: problems.length,
      truncated,
      evidenceTruncated: !!evidence?.limited,
      groups: [...groups.values()].sort((first, second) =>
        JSON.stringify(first).localeCompare(JSON.stringify(second)),
      ),
    };
  } catch {
    return { available: false };
  }
}

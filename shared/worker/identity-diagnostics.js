// Bounded aggregate identity evidence reads without association or storage changes.
import { isSameJson } from "../page/compare.js";
import { ESPN_VENDOR } from "./espn-adapter.js";
import { createIdentityLookup } from "./identity.js";

const PROBLEM_LIMIT = 50;
const SOURCE_LIMIT = 12;
const RECORD_LIMIT = 500;

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

function classifyProblemReason(problem, evidence) {
  if (problem.reason) return problem.reason;
  if (problem.problem === "disputed") return "disputed_association";
  if (problem.vendor !== ESPN_VENDOR || problem.type !== "game") return "evidence_unavailable";
  const record = evidence?.records.get(problem.id);
  if (evidence?.conflicts.has(problem.id)) return "conflicting_retained_evidence";
  if (record && (!record.away || !record.home)) return "missing_team_evidence";
  if (record && !record.start) return "missing_date_evidence";
  if (evidence?.limited) return "evidence_limited";
  return record ? "unclassified" : "evidence_unavailable";
}

function groupProblems(problems, evidence, vendor) {
  const groups = new Map();
  for (const problem of problems) {
    const group = {
      vendor:
        problem.vendor === vendor || problem.vendor === ESPN_VENDOR ? problem.vendor : "other",
      type: problem.type === "game" || problem.type === "player" ? problem.type : "other",
      problem: problem.problem ?? "other",
      reason: classifyProblemReason(problem, evidence),
    };
    const key = JSON.stringify(group);
    const previous = groups.get(key);
    groups.set(key, { ...group, count: (previous?.count ?? 0) + 1 });
  }
  return [...groups.values()].sort((first, second) =>
    JSON.stringify(first).localeCompare(JSON.stringify(second)),
  );
}

async function readProblemEvidence(storage, policy, problems) {
  const games = problems.filter(
    (problem) =>
      problem.vendor === ESPN_VENDOR && problem.type === "game" && problem.problem === "unmatched",
  );
  return games.length
    ? readVendorEvidence(storage, policy, new Set(games.map((game) => game.id)))
    : null;
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
    const evidence = await readProblemEvidence(storage, policy, problems);
    return {
      available: true,
      sampled: problems.length,
      truncated,
      evidenceTruncated: !!evidence?.limited,
      groups: groupProblems(problems, evidence, policy.vendor),
    };
  } catch {
    return { available: false };
  }
}

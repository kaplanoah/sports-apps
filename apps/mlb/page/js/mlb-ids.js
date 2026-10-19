// MLB's ids for its clubs and divisions, as the page names them.
// Runs in both the browser page and the Worker, so it uses no DOM and no globals.

// Postseason placeholders ("AL #3 Seed") have made-up ids, so a miss means no real club yet.
export const MLB_TEAM = {
  108: "LAA",
  109: "ARI",
  110: "BAL",
  111: "BOS",
  112: "CHC",
  113: "CIN",
  114: "CLE",
  115: "COL",
  116: "DET",
  117: "HOU",
  118: "KC",
  119: "LAD",
  120: "WSH",
  121: "NYM",
  133: "ATH",
  134: "PIT",
  135: "SD",
  136: "SEA",
  137: "SF",
  138: "STL",
  139: "TB",
  140: "TEX",
  141: "TOR",
  142: "MIN",
  143: "PHI",
  144: "ATL",
  145: "CWS",
  146: "MIA",
  147: "NYY",
  158: "MIL",
};
export const listClubs = () => Object.values(MLB_TEAM);
// Postseason placeholders have made-up ids, so this is null for them.
export const readClubId = (mlbTeamId) => MLB_TEAM[mlbTeamId] || null;
// The MLB id of one of the page's clubs, or null for a name that isn't one.
export const readMlbTeamId = (club) =>
  Number(Object.keys(MLB_TEAM).find((mlbTeamId) => MLB_TEAM[mlbTeamId] === club)) || null;

export const MLB_DIVISION = {
  200: "AL West",
  201: "AL East",
  202: "AL Central",
  203: "NL West",
  204: "NL East",
  205: "NL Central",
};

/** @type {import("../../../../tests/browser/team-lines.mjs").TeamLineExpectations} */
export const TEAM_LINE_EXPECTATIONS = {
  lines: {
    selector: ".club, .team-title, .game-card-opponent, .runs-half-head",
    name: ":scope > .team-name, :scope > .tbd, :scope > .game-card-name, :scope.team-title > span:not(.dot), :scope.runs-half-head > span:not(.dot)",
    dotHeightSelector: ".game-side .club, .news-teams .club",
  },
  placeholders: [".matchup-row .tbd", ".game-side .club > .tbd", ".series-opp .tbd"],
  roles: {
    small: {
      font: "Libre Franklin",
      size: 12.75,
      weight: 400,
      diameter: 10,
      before: 0,
      after: -0.5,
    },
    team: {
      font: "Libre Franklin",
      size: 13.5,
      weight: 400,
      diameter: 14,
      before: 0,
      after: -1.5,
    },
    large: {
      font: "Libre Franklin",
      size: 16,
      weight: 525,
      diameter: 16,
      before: -0.5,
      after: -1.5,
    },
    label: {
      font: "Libre Franklin",
      size: 12,
      weight: 400,
      diameter: 14,
      before: -0.25,
      after: -0.25,
    },
  },
  roleSelectors: [
    {
      selector: ".news-teams .club, .runs-half-head",
      role: "label",
    },
    {
      selector: ".team-title",
      role: "large",
    },
    {
      selector: ".game-card-opponent, .rank-id .club, .pitcher-id .club",
      role: "small",
    },
  ],
  weightChanges: [
    {
      selector: ".game-side.won .club",
      delta: 150,
    },
  ],
  stateSelectors: [
    { selector: ".field-heads .club", state: "field comparison" },
    { selector: ".matchup-row.winner .club, .game-side.won .club", state: "winner" },
  ],
  baselines: [
    {
      selector: ".field-heads, .sheet-part-head:has(h3 .club):has(> span)",
      name: ".team-name",
      note: ":scope > span",
      state: "baseline heading",
    },
    {
      selector: ".series-row:has(.club)",
      name: ".team-name",
      note: ":scope > span",
      state: "baseline series",
    },
  ],
  allStar: {
    width: 19,
    offset: -3,
  },
  seeds: {},
  attachments: [
    {
      name: "rank chip",
      parents: [".team-id", "tr"],
      selector: ".rank-tag",
      center: "capital",
      offset: 0,
    },
    {
      name: "league chip",
      parents: [".rank-id"],
      selector: ".league-tag",
      center: "lowercase",
      offset: -1,
      gridAreas: '"club league drought"',
    },
  ],
};

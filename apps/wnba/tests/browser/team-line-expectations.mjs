/** @type {import("../../../../tests/browser/team-lines.mjs").TeamLineExpectations} */
export const TEAM_LINE_EXPECTATIONS = {
  roles: {
    small: {
      font: "Barlow Condensed",
      size: 14.5,
      weight: 400,
      diameter: 10,
      before: 0,
      after: -1,
    },
    team: {
      font: "Barlow Condensed",
      size: 15.5,
      weight: 500,
      diameter: 14,
      before: 0,
      after: -1,
    },
    large: {
      font: "Barlow Condensed",
      size: 17.75,
      weight: 500,
      diameter: 16,
      before: -0.75,
      after: -1,
    },
    label: {
      font: "Barlow",
      size: 13,
      weight: 600,
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
      selector: ".team-title, .team-line .club, .faceoff-side .club",
      role: "large",
    },
    {
      selector: ".game-card-opponent",
      role: "small",
    },
  ],
  weightChanges: [
    {
      selector: ".team-line .tbd",
      delta: -100,
    },
  ],
  allStar: {
    width: 18.5,
    offset: -1,
  },
  seeds: {
    small: {
      before: 0,
      after: -0.25,
    },
    team: {
      before: 0,
      after: -0.25,
    },
    large: {
      before: 0.75,
      after: -0.25,
    },
    label: {
      before: 0,
      after: -0.25,
    },
  },
  attachments: [
    {
      name: ".conference-tag",
      parents: [".team-cell"],
      selector: ".conference-tag",
      center: "lowercase",
      offset: -1.75,
    },
    {
      name: ".seed-note",
      parents: [".team-cell"],
      selector: ".seed-note",
      center: "lowercase",
      offset: -0.5,
    },
    {
      name: "outside seed",
      parents: [".team-line"],
      selector: ".seed-label",
      center: "capital",
      offset: 0,
    },
  ],
};

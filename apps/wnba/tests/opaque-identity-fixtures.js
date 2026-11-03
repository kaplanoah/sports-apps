export const OPAQUE_GAMES = [
  {
    id: "g_Qm8sL2pR7vX4",
    leagueId: "league-game-six",
    espnId: "espn-game-six",
    facts: {
      season: 2026,
      isCupFinal: false,
      round: 3,
      series: "3-0",
      number: 6,
      away: "ATL",
      home: "GSV",
      start: "2026-10-29T00:00:00Z",
    },
  },
  {
    id: "g_Rn9tM3qS8wY5",
    leagueId: "league-game-seven",
    espnId: "espn-game-seven",
    facts: {
      season: 2026,
      isCupFinal: false,
      round: 3,
      series: "3-0",
      number: 7,
      away: "ATL",
      home: "GSV",
      start: "2026-11-01T00:00:00Z",
    },
  },
];

export const OPAQUE_PLAYER = {
  id: "p_Sp0uN4rT9xZ6",
  leagueId: "league-player-one",
  espnId: "espn-player-one",
  facts: { season: 2026, team: "ATL", firstName: "Fixture", lastName: "Player" },
};

export const describeLeagueObservations = () => [
  ...OPAQUE_GAMES.map((game) => ({
    type: "game",
    internalId: game.id,
    vendor: "wnba",
    vendorId: game.leagueId,
    facts: game.facts,
    evidence: { method: "existing-id" },
  })),
  {
    type: "player",
    internalId: OPAQUE_PLAYER.id,
    vendor: "wnba",
    vendorId: OPAQUE_PLAYER.leagueId,
    facts: OPAQUE_PLAYER.facts,
    evidence: { method: "existing-id" },
  },
];

export const describeEspnIdentities = () =>
  OPAQUE_GAMES.map((game) => ({ id: game.espnId, ...game.facts }));

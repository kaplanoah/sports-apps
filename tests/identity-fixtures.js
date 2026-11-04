export const createGame = (id) => ({
  id: String(id),
  state: "final",
  season: 2026,
  away: { team: "NYL" },
  home: { team: "LVA" },
  start: "2026-06-01T18:00:00Z",
});

export const nameStoredGameId = (app, index) =>
  app === "wnba" ? `10226${String(index + 1).padStart(5, "0")}` : String(index + 1);

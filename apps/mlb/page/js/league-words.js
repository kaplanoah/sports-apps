/** @type {import("#shared/league-words.js").LeagueWords} */
export const LEAGUE_WORDS = {
  seasonOpener: "Opening Day",
  allStar: "All-Star Game",
  cup: null,
  hasDoubleheaders: true,
  pastRegulation: {
    name: "Extra innings",
    words: ["extra innings", "extra inning", "extras", "extra frames", "free baseball"],
    games: "extra-inning games",
  },
  crossConference: { name: "Interleague", words: ["interleague", "inter league"] },
  neverShown: [
    "postseason",
    "post-season",
    "post season",
    "berth",
    "Finals",
    "overtime",
    "conference",
    "quarter",
    "Commissioner's Cup",
  ],
};

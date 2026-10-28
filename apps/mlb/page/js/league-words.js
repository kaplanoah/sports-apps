/** @type {import("#shared/league-words.js").LeagueWords} */
export const LEAGUE_WORDS = {
  notificationUpdates: "Game updates",
  reminderAtStart: "At scheduled first pitch",
  reminderTiming: "Time before game",
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
  seasonSpansYears: false,
  searchFiller: ["pitch", "pitches", "pitching", "starter", "starters"],
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

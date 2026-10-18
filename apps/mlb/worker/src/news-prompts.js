import { composeLabelPrompt } from "../../../../shared/worker/news-prompts.js";
import { TEAMS } from "../../page/js/teams.js";

// What MLB's news asks Claude: everything a Mets fan would want about the Mets, and another club's
// news only when it matters across baseball. Check a fresh week of stories against any change.

export const LABEL_PROMPT = composeLabelPrompt({
  intro:
    "You pick the stories for an MLB app's news feed. Its readers are New York Mets fans, who open it to learn what matters about the Mets, and the news that matters across baseball: the postseason, the labor talks and any lockout, rule changes, awards, records, the biggest trades and free-agent signings, coaching and top front-office changes, and what's next for each team the postseason knocked out. Another club's news is in the feed only when it's one of those; the Yankees are another club. The feed links to each outlet, so a good story is one worth leaving the app to read.",
  keep: [
    "Mets news: anything a Mets fan would want to know, whoever reports it, from a minor roster move or an injury to a contract, a coaching or front-office change, a prospect's progress, or the owner's plans, to a look back at one Met's season.",
    "League news: the postseason, the labor talks and a lockout, rule changes, awards, records, the biggest trades and signings, and coaching and top front-office changes, for any club, and what's next for a team the postseason knocked out.",
    "A standout game: one player's big night, a record, a comeback, an emotional or telling moment, in a Mets game or a postseason game, even when it reads like a game story.",
    "Analysis: why the Mets or a postseason team won or lost, how a matchup works, or what the Mets must change.",
    "A series preview that argues something: matchups, predictions, or one team's edge.",
    "Features and profiles of the Mets' players, coaches, executives, and prospects, and of the people at the center of the postseason or the league's news.",
    "Opinion columns from a named writer that take a clear position on Mets or league news.",
  ],
  drop: [
    "other-club: news about one club other than the Mets that isn't league news, like its injuries, its minor moves, its offseason plans, or its players' wishes. A team the postseason knocked out isn't another club here: what's next for it is league news.",
    "recap: a story that only retells a game's score and order of events, with no standout angle. A historic result told only as a score is still a recap; deeper stories carry the history.",
    "preview: a game listing or setup that only says who plays when and what's at stake, or recounts how two teams got to a series.",
    "near-mets: a story about a former Met, or one the Mets' broadcasters are in, that isn't about the Mets now.",
    "schedule, betting, video, newsletter, podcast, quiz, poll, fantasy, reference (lists and histories), roundup (every team at once, or a day's links).",
    "wrap-up: a look back at a finished season's highs and lows, but for one Met's season, which is Mets news.",
    "back-and-forth: an owner's or executive's boast, or a reply in a public dispute, that adds no news.",
    "off-the-field: culture or naming disputes away from baseball.",
    "novelty: an odd or viral angle with no baseball news, even about a Met.",
    "retold: news a card already tells, without enough to go under it.",
  ],
  leadRules: [
    "A report that a second outlet confirms leads over an earlier report from one source, unless the first came from Jeff Passan or Ken Rosenthal, whose reports are rarely wrong.",
    "When MLB Trade Rumors retells another outlet's reporting, that outlet's own story leads, and MLB Trade Rumors' goes under it only when it adds context the lead lacks.",
  ],
  teamsName: "the MLB teams",
  teamNames: Object.fromEntries(Object.entries(TEAMS).map(([code, team]) => [code, team.name])),
  sampleTeam: "NYM",
});

// What the news drops without asking Claude: what a story's link, ESPN's own word for it, or a
// plain title already says isn't news, in every league's outlets and in any a league adds. Anything
// these can't tell goes to Claude.

const ESPN_TYPE_DROPS = { Media: "video", Preview: "preview", Recap: "recap" };

/** @type {[RegExp, string][]} */
const URL_DROPS = [
  [/\/video\//, "video"],
  [/-the-(pulse|windup)\/?$|\/newsletter\//, "newsletter"],
  [/trivia|quiz/, "quiz"],
];

/** @type {[RegExp, string][]} */
const TITLE_DROPS = [
  [/\bodds\b|\bbetting\b|\bpicks against\b|\bbest bets?\b/i, "betting"],
  [/\bschedule\b|where to watch|watch guide|games today/i, "schedule"],
  [/scores from last night|scores, results|game highlights/i, "recap"],
  [/guides? for every|power rankings/i, "roundup"],
  [/\btrivia\b|\bquiz\b/i, "quiz"],
];

/**
 * Why a story isn't news, or null when only Claude can say, by the rules every league's news keeps
 * and the ones a league's own outlets need.
 * @param {{ urlDrops?: [RegExp, string][], titleDrops?: [RegExp, string][] }} [leagueRules]
 * @returns {(story: { url: string, title: string, espnType?: string }) => string | null}
 */
export function createRuleDrop({ urlDrops = [], titleDrops = [] } = {}) {
  const byUrl = [...URL_DROPS, ...urlDrops];
  const byTitle = [...TITLE_DROPS, ...titleDrops];
  return (story) => {
    if (ESPN_TYPE_DROPS[story.espnType]) return ESPN_TYPE_DROPS[story.espnType];
    const urlDrop = byUrl.find(([pattern]) => pattern.test(story.url));
    if (urlDrop) return urlDrop[1];
    const titleDrop = byTitle.find(([pattern]) => pattern.test(story.title));
    return titleDrop ? titleDrop[1] : null;
  };
}

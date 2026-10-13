// The prompt Claude judges a league's news by: the league's own readers and what they keep and
// drop, then how every league's cards work and what Claude answers with, then the league's
// examples of how its editor decided.

const CARD_RULES = `The feed shows each piece of news as one card: the story that tells it best, with a few others under it as More on this. You get the cards so far, each with its number, its lead, and the stories under it, then the new stories, numbered after them, in the order they came out.

When a new story tells news a card already tells, or an earlier new story does, give that number as same. Then:
- If it tells the news better than the card's lead, set lead to true. It leads the card, and the old lead goes under it. Reward quality, not speed: a deeper, better-reported, or better-written story should lead, whenever it came out.
- Otherwise keep it only if it earns a place under the card, and the bar rises with each story the card has. Under a lead alone, it needs something the lead lacks: new facts, the why, or the people's own words. Under a lead with one story under it, it must add something real that neither has. With two or more under the lead, it must be exceptional. Otherwise drop it as retold.
A new development in a card's story, like an injured player ruled out of the next game, leads that card: give its number as same and set lead to true, so the latest news leads and what came before goes under it.`;

/** @param {string[]} lines */
const listLines = (lines) => lines.map((line) => `- ${line}`).join("\n");

/**
 * @param {object} league
 * @param {string} league.intro who the readers are and what they come for
 * @param {string[]} league.keep
 * @param {string[]} league.drop each reason a story is dropped, with what it means
 * @param {string[]} [league.leadRules] what else decides which story leads a card
 * @param {string} league.teamsName the league's teams, as in "the WNBA teams"
 * @param {Record<string, string>} league.teamNames each team's code and the name Claude knows it by
 * @param {string} league.sampleTeam a team's code for the answer's sample
 * @param {[string, string][]} [league.examples] the editor's verdict on each of a few stories
 */
export function composeLabelPrompt({
  intro,
  keep,
  drop,
  leadRules = [],
  teamsName,
  teamNames,
  sampleTeam,
  examples = [],
}) {
  const teamList = Object.entries(teamNames)
    .map(([code, name]) => `${code} (${name})`)
    .join(", ");
  const sections = [
    intro,
    `Keep:\n${listLines(keep)}`,
    `Drop, with its reason:\n${listLines(drop)}`,
    [CARD_RULES, ...leadRules].join("\n"),
    `For each new story, give:
- keep: true or false.
- why: when keep is false, one of the drop reasons above, or other.
- same: the number of the card or new story whose news it tells, only when it tells news one already does.
- lead: true when it should lead that card.
- teams: the codes of ${teamsName} the story is about, most central first, from: ${teamList}.
- reason: one short sentence.`,
    `Answer with stories, one object per new story, in their order: {"id": 14, "keep": true, "same": 3, "lead": false, "teams": ["${sampleTeam}"], "reason": "..."}.`,
  ];
  if (examples.length)
    sections.push(
      `Examples of how the app's editor decided:\n${examples.map(([verdict, story]) => `- ${verdict}: ${story}`).join("\n")}`,
    );
  return sections.join("\n\n");
}

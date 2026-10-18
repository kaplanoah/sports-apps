import { createNewsJob } from "../../../../shared/worker/news-updater.js";
import { createRuleDrop } from "../../../../shared/worker/news-rules.js";
import { TEAMS } from "../../page/js/teams.js";
import { readMlbNews } from "./news-feeds.js";
import { LABEL_PROMPT } from "./news-prompts.js";

// MLB's news, which the shared news job keeps from its outlets, judged by its prompt. Its outlets
// post a few things every league's rules don't know aren't news: Baseball Prospectus's fantasy
// pages and its Spanish copies of what it posts in English, the daily link roundups, chats,
// podcast episodes, and MLB Trade Rumors' reader polls.

const URL_DROPS = /** @type {[RegExp, string][]} */ ([
  [/\/fantasy\//, "fantasy"],
  [/\/en-espanol\//, "translation"],
]);

const TITLE_DROPS = /** @type {[RegExp, string][]} */ ([
  [/^Mets Morning News\b|^The Opener:/i, "roundup"],
  [/\bsubscriber chat\b|\bopen thread\b/i, "chat"],
  [/^PosCasting\b/i, "podcast"],
  [/^Poll:/i, "poll"],
  [/^Latest .*injuries & transactions$/i, "reference"],
]);

export const readMlbRuleDrop = createRuleDrop({ urlDrops: URL_DROPS, titleDrops: TITLE_DROPS });

/** @param {{ readFeeds?: typeof readMlbNews }} [options] */
export const createMlbNewsJob = ({ readFeeds = readMlbNews } = {}) =>
  createNewsJob({
    readFeeds,
    prompt: LABEL_PROMPT,
    teamCodes: Object.keys(TEAMS),
    readRuleDrop: readMlbRuleDrop,
  });

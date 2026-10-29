import { readNewsFeeds } from "../../../../shared/worker/news-feeds.js";
import { parseAtom, parseEspnNews, parseRss } from "../../../../shared/worker/news-parse.js";
import { ESPN_SITE } from "../../page/js/snapshot.js";
import { ESPN_HEADERS } from "./wnba.js";

// The outlets the WNBA's news reads, the Liberty's own beat writers among them.

/** @type {import("../../../../shared/worker/news-feeds.js").NewsFeed[]} */
export const NEWS_FEEDS = [
  {
    id: "espn",
    source: "espn",
    outlet: "ESPN",
    url: `${ESPN_SITE}/news?limit=50`,
    parse: (text) => parseEspnNews(JSON.parse(text)),
  },
  {
    id: "athletic",
    source: "athletic",
    outlet: "The Athletic",
    url: "https://www.nytimes.com/athletic/rss/wnba/",
    parse: parseRss,
  },
  {
    id: "ix",
    source: "ix",
    outlet: "The IX",
    url: "https://www.theixsports.com/category/wnba/feed/",
    parse: parseRss,
  },
  {
    id: "ix-liberty",
    source: "ix",
    outlet: "The IX",
    url: "https://www.theixsports.com/category/new-york-liberty/feed/",
    parse: parseRss,
    team: "NYL",
  },
  {
    id: "winsidr",
    source: "winsidr",
    outlet: "Winsidr",
    url: "https://winsidr.com/feed/",
    parse: parseRss,
  },
  {
    id: "nypost",
    source: "nypost",
    outlet: "NY Post",
    url: "https://nypost.com/tag/new-york-liberty/feed/",
    parse: parseRss,
    team: "NYL",
  },
  {
    id: "netsdaily",
    source: "netsdaily",
    outlet: "NetsDaily",
    url: "https://www.netsdaily.com/rss/index.xml",
    parse: parseAtom,
    team: "NYL",
    pathIncludes: "/nyliberty/",
  },
];

/** @param {typeof fetch} fetchImpl */
export const readWnbaNews = (fetchImpl) =>
  readNewsFeeds(fetchImpl, NEWS_FEEDS, { userAgent: ESPN_HEADERS["user-agent"] });

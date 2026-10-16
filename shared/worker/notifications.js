import { capitalize, convertToText } from "../page/html.js";

const MAX_NOTIFIED = 4;

/**
 * Past a few at once, the rest are summed up in one, so a busy night doesn't bury the phone.
 * The summary's tag is its first hidden message's, so a later summary doesn't replace it.
 * @param {{ title: string, body: string, tag: string }[]} messages
 * @param {(count: number) => string} describeMore the summary's title for `count` more
 */
export function capNotifications(messages, describeMore) {
  if (messages.length <= MAX_NOTIFIED) return messages;
  const shown = messages.slice(0, MAX_NOTIFIED - 1);
  const hidden = messages.slice(shown.length);
  return [
    ...shown,
    {
      title: describeMore(hidden.length),
      body: "Open the page to see them all.",
      tag: `more:${hidden[0].tag}`,
    },
  ];
}

// A line of the page breaks into its main clause and what explains it at a spaced dash.
const SENTENCE_BREAK = /\s\u2014\s/;

/**
 * A notification that says what a line of the page says: its main clause is the title, and what
 * explains it is the body.
 * @param {unknown} markup the line as the page shows it
 * @param {string} tag
 */
export function describeAsNotification(markup, tag) {
  const [title, ...rest] = convertToText(markup).split(SENTENCE_BREAK);
  return { title, body: capitalize(rest.join(" \u2014 ")), tag };
}

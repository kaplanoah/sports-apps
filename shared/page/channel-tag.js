// Keeps the age in the tag beside the app's name current while the page stays open, as
// draw-channel-tag-age.js first drew it.

import { watchTimeAway } from "./resume.js";

/* global drawChannelTagAge -- from draw-channel-tag-age.js */

const MINUTE_MS = 60 * 1000;

export function startChannelTag() {
  setInterval(drawChannelTagAge, MINUTE_MS);
  watchTimeAway(drawChannelTagAge);
}

// The build writes the channel tag with a <time> of the deploy, and this plain script, in the
// head, draws how long ago that was before the first paint, so the tag shows whole as the page
// opens.

/**
 * How long ago a moment was: "just now", then minutes, whole hours, and days.
 * @param {number} ms
 */
function describeTimeSince(ms) {
  const minutes = Math.floor(ms / (60 * 1000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function drawChannelTagAge() {
  const time = document.querySelector("#channelTag time");
  if (time instanceof HTMLTimeElement)
    time.textContent = describeTimeSince(Date.now() - Date.parse(time.dateTime));
}

// Which game a notification asks the page to open, from its message or the page's address.
function readGameIntent(message) {
  if (
    !/^\d{1,12}$/.test(String(message?.game ?? "")) ||
    !Number.isInteger(message?.season) ||
    message.season < 1900 ||
    message.season > 2200
  )
    return null;
  return { game: String(message.game), season: message.season };
}

/** @param {string} href */
function readNotificationIntent(href) {
  const { searchParams } = new URL(href);
  return {
    isRequested: searchParams.has("game"),
    target: readGameIntent({
      game: searchParams.get("game"),
      season: Number(searchParams.get("season")),
    }),
  };
}

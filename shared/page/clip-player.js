// Plays a game's clips full screen in the device's own player, as the leagues' own apps do: a tap
// on a clip's button hands its video to one video element the page keeps out of sight, which an
// iPhone plays full screen on its own, and which any other device puts full screen as it starts.
// Once the player closes, the video stops and lets go of what it loaded.

const STREAM_TYPE = "application/vnd.apple.mpegurl";

/**
 * The address a clip plays from: its stream where the browser plays one, which starts after its
 * first few seconds arrive, or else its whole video.
 * @param {{ video?: string, stream?: string }} addresses
 * @param {{ canPlayType: (type: string) => string }} player
 */
export const pickClipAddress = ({ video, stream }, player) =>
  stream && player.canPlayType(STREAM_TYPE) ? stream : video;

/** @type {HTMLVideoElement | null} */
let player = null;

/** @param {HTMLVideoElement} video */
function stopPlaying(video) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function createPlayer() {
  const video = document.createElement("video");
  video.className = "clip-player";
  video.controls = true;
  video.preload = "none";
  video.addEventListener("webkitendfullscreen", () => stopPlaying(video));
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement !== video) stopPlaying(video);
  });
  document.body.append(video);
  return video;
}

// An iPhone that already went full screen on its own has nothing left to enter.
/** @param {HTMLVideoElement & { webkitEnterFullscreen?: () => void }} video */
function enterSafariPlayer(video) {
  try {
    video.webkitEnterFullscreen?.();
  } catch {
    // It plays full screen already.
  }
}

/**
 * Puts the video full screen in the browser's own way: Safari's own player where it has one,
 * which needs the video to have started.
 * @param {HTMLVideoElement & { webkitEnterFullscreen?: () => void }} video
 */
function enterFullscreen(video) {
  if (video.requestFullscreen) {
    video.requestFullscreen().catch(() => enterSafariPlayer(video));
    return;
  }
  video.addEventListener("playing", () => enterSafariPlayer(video), { once: true });
}

/**
 * Plays a clip full screen. It must run inside the tap's own handler, which a browser requires
 * to start a video with sound or put it full screen.
 * @param {DOMStringMap} addresses the clip button's, whose video is set
 */
function playClip(addresses) {
  player ??= createPlayer();
  player.src = /** @type {string} */ (pickClipAddress(addresses, player));
  enterFullscreen(player);
  player.play().catch(() => stopPlaying(/** @type {HTMLVideoElement} */ (player)));
}

/**
 * Plays each clip a tap lands on inside `holder`.
 * @param {HTMLElement} holder
 */
export function watchClipTaps(holder) {
  holder.addEventListener("click", (event) => {
    const button = /** @type {Element} */ (event.target).closest(".clip-open");
    if (button instanceof HTMLElement && button.dataset.video) playClip(button.dataset);
  });
}

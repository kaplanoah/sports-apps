// Plays a game's clips full screen in the device's own player, as the leagues' own apps do: a tap
// on a clip's button hands its stream, or else its video, to one video element the page keeps out
// of sight, which an iPhone plays full screen on its own, and which any other device puts full
// screen as it starts. A stream that fails gives way to the video. A finger's press starts loading
// its clip, so the clip is on its way by the time the tap's click plays it, and a press that turns
// into a scroll lets it go. Once the player closes, the video stops and lets go of what it loaded.

import { hasDrifted, isOnGlide } from "./press.js";

const STREAM_TYPE = "application/vnd.apple.mpegurl";

/**
 * The address a clip plays from: its stream where the browser plays one, which starts after its
 * first few seconds arrive, or else its whole video.
 * @param {{ video: string, stream?: string }} addresses
 * @param {{ canPlayType: (type: string) => string }} player
 */
export const pickClipAddress = ({ video, stream }, player) =>
  stream && player.canPlayType(STREAM_TYPE) ? stream : video;

/** @type {HTMLVideoElement | null} */
let player = null;
// The clip button a pointer pressed, whose clip the player is loading, until its click plays it.
/** @type {{ button: HTMLElement, x: number, y: number } | null} */
let pressedClip = null;

/** @param {HTMLVideoElement} video */
function stopPlaying(video) {
  delete video.dataset.fallback;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function createPlayer() {
  const video = document.createElement("video");
  video.className = "clip-player";
  video.controls = true;
  video.preload = "auto";
  video.addEventListener("error", () => playFallback(video));
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
 * Plays what the video holds, stopping if the browser refuses while it still holds it.
 * @param {HTMLVideoElement} video
 */
function startPlaying(video) {
  const address = video.getAttribute("src");
  video.play().catch(() => {
    if (video.getAttribute("src") === address) stopPlaying(video);
  });
}

/**
 * Loads the clip's video once its stream fails to load, and plays it once the clip was tapped.
 * @param {HTMLVideoElement} video
 */
function playFallback(video) {
  const fallback = video.dataset.fallback;
  if (!fallback) return;
  delete video.dataset.fallback;
  video.src = fallback;
  if (!pressedClip) startPlaying(video);
}

/**
 * Starts loading a clip into the player, its stream where the browser plays one.
 * @param {{ video: string, stream?: string }} addresses
 */
function loadClip(addresses) {
  player ??= createPlayer();
  const address = pickClipAddress(addresses, player);
  if (address === addresses.video) delete player.dataset.fallback;
  else player.dataset.fallback = addresses.video;
  player.src = address;
  return player;
}

/**
 * The player, while it holds the clip a press on `button` loaded.
 * @param {HTMLElement} button
 */
const findLoadedPlayer = (button) =>
  pressedClip?.button === button && player?.hasAttribute("src") ? player : null;

/**
 * Plays a clip full screen, from what its press loaded. It must run inside the tap's own handler,
 * which a browser requires to start a video with sound or put it full screen.
 * @param {HTMLElement} button
 * @param {{ video: string, stream?: string }} addresses
 */
function playClip(button, addresses) {
  const video = findLoadedPlayer(button) ?? loadClip(addresses);
  pressedClip = null;
  enterFullscreen(video);
  startPlaying(video);
}

/** @param {EventTarget | null} target */
function findClipButton(target) {
  const button = target instanceof Element ? target.closest(".clip-open") : null;
  return button instanceof HTMLElement ? button : null;
}

/** @param {HTMLElement} button */
function readAddresses(button) {
  const { video, stream } = button.dataset;
  return video ? { video, stream } : null;
}

/** @param {PointerEvent} event */
function startLoading(event) {
  if (!event.isPrimary || event.button !== 0 || isOnGlide(event.target)) return;
  const button = findClipButton(event.target);
  const addresses = button && readAddresses(button);
  if (!button || !addresses) return;
  loadClip(addresses);
  pressedClip = { button, x: event.clientX, y: event.clientY };
}

function releaseLoad() {
  if (!pressedClip || !player) return;
  pressedClip = null;
  stopPlaying(player);
}

/** @param {PointerEvent} event */
function followDrift(event) {
  if (pressedClip && event.isPrimary && hasDrifted(pressedClip, event)) releaseLoad();
}

/** @param {PointerEvent} event */
function cancelLoad(event) {
  if (event.isPrimary) releaseLoad();
}

/** @param {MouseEvent} event */
function playTappedClip(event) {
  const button = findClipButton(event.target);
  const addresses = button && readAddresses(button);
  if (button && addresses) playClip(button, addresses);
}

/**
 * Loads each clip a press lands on inside `holder`, and plays it on the tap.
 * @param {HTMLElement} holder
 */
export function watchClipTaps(holder) {
  holder.addEventListener("pointerdown", startLoading, { passive: true });
  holder.addEventListener("pointermove", followDrift, { passive: true });
  holder.addEventListener("pointercancel", cancelLoad, { passive: true });
  holder.addEventListener("click", playTappedClip);
}

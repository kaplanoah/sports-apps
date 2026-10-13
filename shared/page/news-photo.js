// How a story's photo sits on its card. The frame takes the photo's own shape from 16:9 to 3:2,
// the shapes news photos come in, so most show whole. A wider photo loses its sides, and a taller
// one is cut to 3:2 where Claude says its subject is, or, where Claude hasn't said, with the frame's
// middle 22% of the photo's height above the photo's, where a news photo's faces mostly are.

export const WIDEST_FRAME = 16 / 9;
const TALLEST_FRAME = 3 / 2;
// A photo a hair taller than 3:2, like one 1024 by 683, shows as 3:2 with a sliver cut.
const ROUNDING = 0.99;
const LIFT_FROM_MIDDLE = 0.22;

/**
 * A story's photo, with its size once the Worker has read it, and, for one taller than the frame,
 * where the frame starts, as a share of its height down from its top, once Claude has said.
 * @typedef {object} NewsPhoto
 * @property {string} url
 * @property {string} credit
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [frameTop]
 */

/** @param {{ width: number, height: number }} size */
export const isTallerThanFrame = ({ width, height }) => width / height < TALLEST_FRAME * ROUNDING;

/**
 * The share of a photo's height a 3:2 frame across its width shows.
 * @param {{ width: number, height: number }} size
 */
const findFrameShare = ({ width, height }) => width / height / TALLEST_FRAME;

/** @param {number} top @param {number} share */
const keepInPhoto = (top, share) => Math.min(1 - share, Math.max(0, top));

/**
 * Where a 3:2 frame starts on a taller photo, as a share of its height, to hold the subject between
 * `subjectTop` and `subjectBottom`, shares of its height too: centered on it when it fits, and from
 * its top, where the faces are, when it doesn't.
 * @param {{ width: number, height: number }} size
 * @param {number} subjectTop
 * @param {number} subjectBottom
 */
export function chooseFrameTop(size, subjectTop, subjectBottom) {
  const share = findFrameShare(size);
  const fits = subjectBottom - subjectTop <= share;
  return keepInPhoto(fits ? (subjectTop + subjectBottom - share) / 2 : subjectTop, share);
}

/**
 * The frame's shape, as width over height, and how far down the photo it sits, as a percentage for
 * CSS's object-position. A photo whose size the Worker hasn't read gets a 16:9 frame from its top,
 * where the lift from the middle puts a 3:2 photo, the shape most come in.
 * @param {NewsPhoto} photo
 * @returns {{ aspect: number, position: number }}
 */
export function framePhoto(photo) {
  if (!photo.width || !photo.height) return { aspect: WIDEST_FRAME, position: 0 };
  const size = { width: photo.width, height: photo.height };
  if (!isTallerThanFrame(size)) {
    const shape = size.width / size.height;
    return { aspect: Math.min(WIDEST_FRAME, Math.max(TALLEST_FRAME, shape)), position: 50 };
  }
  const share = findFrameShare(size);
  const top = photo.frameTop ?? keepInPhoto(0.5 - LIFT_FROM_MIDDLE - share / 2, share);
  return { aspect: TALLEST_FRAME, position: (top / (1 - share)) * 100 };
}

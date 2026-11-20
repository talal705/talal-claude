/**
 * How far (CSS pixels) the pointer may travel between press and release for the release to count as a
 * click or tap. Further than this it was a drag of the camera (or of a held part): nothing is selected,
 * placed or switched by it.
 */
export const TAP_SLOP_PX = 6;

/** True for a real click or tap; false when the press turned into a drag. `delta` is three.js-fiber's travel in px. */
export const isTap = (event: { delta: number }): boolean => event.delta <= TAP_SLOP_PX;

/** True once a pressed pointer has travelled far enough from where it went down to be a drag. */
export const pastSlop = (from: readonly [number, number], x: number, y: number): boolean => Math.hypot(x - from[0], y - from[1]) > TAP_SLOP_PX;

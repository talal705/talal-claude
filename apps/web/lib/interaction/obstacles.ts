// What is on the page right now that the robot must not stand on. Reads the DOM; the list of
// element kinds is fixed here and nothing from outside is used as a selector.
import type { TargetRect } from "@ytl/contracts";

/** Controls and media: the whole box counts. */
const BOXES =
  "a[href],button,input,select,textarea,summary,img,video,canvas,[role='button'],[role='link'],[role='tab'],[role='switch'],[contenteditable='true']";
/** Text: only the lines of text count, not the empty part of the block around them. */
const TEXT = "h1,h2,h3,h4,h5,h6,p,li,label,legend,dt,dd,figcaption,blockquote,pre,td,th";
const LIMIT = 400;

/**
 * Viewport rectangles of visible controls and text lines, skipping anything inside `ignore`
 * (the tutor's own elements). Filter the result with `relevantObstacles` before placing.
 */
export function collectContentRects(ignore: readonly (Element | null)[]): TargetRect[] {
  const rects: TargetRect[] = [];
  const height = window.innerHeight;
  const width = document.documentElement.clientWidth;
  const skipped = (element: Element) => ignore.some((own) => own?.contains(element));
  const add = (box: DOMRect) => {
    if (box.width <= 0 || box.height <= 0) return;
    if (box.bottom <= 0 || box.top >= height || box.right <= 0 || box.left >= width) return;
    rects.push({ x: box.x, y: box.y, width: box.width, height: box.height });
  };
  const shown = (element: Element) =>
    typeof element.checkVisibility !== "function" || element.checkVisibility({ visibilityProperty: true });

  for (const element of document.body.querySelectorAll(BOXES)) {
    if (rects.length >= LIMIT) return rects;
    if (skipped(element) || !shown(element)) continue;
    add(element.getBoundingClientRect());
  }
  const range = document.createRange();
  for (const element of document.body.querySelectorAll(TEXT)) {
    if (rects.length >= LIMIT) break;
    if (skipped(element) || !shown(element)) continue;
    const outer = element.getBoundingClientRect();
    if (outer.bottom <= 0 || outer.top >= height) continue;
    range.selectNodeContents(element);
    for (const line of range.getClientRects()) add(line);
  }
  return rects;
}

/** Space around the idle robot that must also be empty, so it leaves before content reaches it. */
const IDLE_CLEARANCE = 10;

/**
 * True when no control or text block is under the rectangle. Hit-tests a small grid of points, so
 * it is cheap enough to run on every scroll frame. Stricter than the pointing rule: the whole box
 * of a text block counts, not only its lines.
 */
export function isAreaFree(rect: TargetRect, ignore: readonly (Element | null)[]): boolean {
  const left = rect.x - IDLE_CLEARANCE;
  const top = rect.y - IDLE_CLEARANCE;
  const width = rect.width + IDLE_CLEARANCE * 2;
  const height = rect.height + IDLE_CLEARANCE * 2;
  const columns = 4;
  const rows = 5;
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const element = document.elementFromPoint(left + (width * column) / columns, top + (height * row) / rows);
      if (!element || ignore.some((own) => own?.contains(element))) continue;
      if (element.closest(`${BOXES},${TEXT}`)) return false;
    }
  }
  return true;
}

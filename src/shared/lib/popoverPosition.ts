/** CSS bounds the menu size; flip around the pointer, then clamp to the viewport. */
export function popoverPosition(x: number, y: number, width: number, height: number,
  viewportWidth: number, viewportHeight: number, margin = 8) {
  const left = x + width <= viewportWidth - margin ? x : x - width;
  const top = y + height <= viewportHeight - margin ? y : y - height;
  return {
    x: Math.max(margin, Math.min(left, viewportWidth - width - margin)),
    y: Math.max(margin, Math.min(top, viewportHeight - height - margin))
  };
}

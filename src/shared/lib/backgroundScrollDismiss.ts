// A click may follow an automatic scroll-to-trigger whose scroll notification
// arrives after the popover opens. Ignore that already-completed scroll, but
// dismiss when the background actually moves again.
export function backgroundScrollDismiss(close: () => void) {
  const offsets = new Map(Array.from(document.querySelectorAll(
    ".favorites-list, .favorite-folders, .favorites-view, .main-content, [data-virtuoso-scroller], #root, body, html"
  )).map(element => [element, { x: element.scrollLeft, y: element.scrollTop }]));
  return (event: Event) => {
    const element = event.target instanceof Element ? event.target : document.scrollingElement;
    if (element?.closest(".viewport-popover")) return;
    const initial = element && offsets.get(element);
    if (initial && element && initial.x === element.scrollLeft && initial.y === element.scrollTop) return;
    close();
  };
}


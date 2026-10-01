import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { moveAfter, moveBefore, sameOrder } from "../lib/uiOrder";

/** Hold time before a press turns into a drag. */
export const LONG_PRESS_MS = 450;
/** Pointer travel (px) before the hold is cancelled (treated as a normal click / scroll). */
const MOVE_TOLERANCE = 6;
/** Edge zone (px) of a scrollable row that auto-scrolls while dragging. */
const EDGE_SCROLL_ZONE = 28;

// Motion tokens (Emil Kowalski's animation guidelines): strong ease-out for UI,
// short durations, transform-only.
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
/** Siblings sliding out of the way. */
const SHIFT_MS = 200;
/** Lift when the hold completes. */
const LIFT_MS = 150;
/** Dragged item settling into its slot on release. */
const SETTLE_MS = 200;
const PRESS_SCALE = 0.96;
const LIFT_SCALE = 1.06;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface PressState {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  el: HTMLElement;
  pressAnim: Animation | null;
}

interface DragState {
  id: string;
  el: HTMLElement;
  startX: number;
  startScroll: number;
  startOffset: number;
  lastX: number;
}

/**
 * Long-press-to-drag reordering for one horizontal row.
 *
 * - Press and hold ~0.45 s (the item shrinks slightly while "charging"), it
 *   lifts, then follows the pointer 1:1 (transform written straight to the
 *   element, no React render per frame).
 * - Siblings slide out of the way with a FLIP animation (WAAPI, transform
 *   only). Slot hit-testing uses layout positions (offsetLeft), never the
 *   animated ones, so items can't flicker back and forth mid-animation.
 * - On release the item settles into its slot; the click that follows a drag
 *   is swallowed. A short press is an ordinary click.
 * - Items carry `data-reorder-id` (spread `itemProps(id)`) inside the element
 *   that receives `containerRef`. `order` may include ids not rendered right
 *   now; they keep their relative slot.
 */
export function useLongPressReorder(
  order: readonly string[],
  onCommit: (next: string[]) => void,
  options: { delay?: number; disabled?: boolean } = {}
) {
  const delay = options.delay ?? LONG_PRESS_MS;
  const disabled = options.disabled ?? false;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** True while dragging or settling; lets other layout animations stand down. */
  const [busy, setBusy] = useState(false);
  const press = useRef<PressState | null>(null);
  const drag = useRef<DragState | null>(null);
  const timer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const previewRef = useRef<string[] | null>(null);
  /** Visual positions captured right before an order change (FLIP "First"). */
  const snapshot = useRef<Map<string, number> | null>(null);
  /** Dragged element waiting to settle after release (handled in the layout effect). */
  const pendingSettle = useRef<{ el: HTMLElement; center: number; scale: string } | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const items = () =>
    Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-reorder-id]") ?? []);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const takeSnapshot = () => {
    const map = new Map<string, number>();
    for (const el of items()) map.set(el.dataset.reorderId!, el.getBoundingClientRect().left);
    snapshot.current = map;
  };

  /** Keep the dragged item under the pointer, whatever slot it currently occupies. */
  const applyDragTransform = () => {
    const d = drag.current;
    const container = containerRef.current;
    if (!d || !container) return;
    const dx =
      d.lastX - d.startX + (container.scrollLeft - d.startScroll) - (d.el.offsetLeft - d.startOffset);
    d.el.style.transform = `translate3d(${dx}px, 0, 0) scale(${prefersReducedMotion() ? 1 : LIFT_SCALE})`;
  };

  // FLIP: after React moved the DOM nodes, slide every sibling from where it
  // was on screen to its new slot. Running animations are cancelled first so
  // the new layout position is measured without them; the snapshot already
  // holds the in-flight visual position, so motion continues without a jump.
  useLayoutEffect(() => {
    const reduce = prefersReducedMotion();
    const settle = pendingSettle.current;
    pendingSettle.current = null;
    const before = snapshot.current;
    snapshot.current = null;
    if (before) {
      const dragId = drag.current?.id;
      for (const el of items()) {
        const id = el.dataset.reorderId!;
        if (id === dragId || el === settle?.el) continue;
        const first = before.get(id);
        if (first === undefined) continue;
        el.getAnimations().forEach((a) => {
          if ((a as Animation & { __reorder?: boolean }).__reorder) a.cancel();
        });
        const delta = first - el.getBoundingClientRect().left;
        if (Math.abs(delta) < 0.5 || reduce) continue;
        const anim = el.animate(
          [{ transform: `translate3d(${delta}px, 0, 0)` }, { transform: "translate3d(0, 0, 0)" }],
          { duration: SHIFT_MS, easing: EASE_OUT }
        );
        (anim as Animation & { __reorder?: boolean }).__reorder = true;
      }
    }
    if (settle) {
      // Released item: from where it is drawn now into its (final) slot.
      const { el } = settle;
      el.style.transform = "";
      const r = el.getBoundingClientRect();
      const delta = settle.center - (r.left + r.width / 2);
      if (!reduce && (Math.abs(delta) >= 0.5 || settle.scale !== "1")) {
        el.animate(
          [
            { transform: `translate3d(${delta}px, 0, 0) scale(${settle.scale})` },
            { transform: "translate3d(0, 0, 0) scale(1)" }
          ],
          { duration: SETTLE_MS, easing: EASE_OUT }
        );
      }
    }
    applyDragTransform();
  });

  useEffect(
    () => () => {
      clearTimer();
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    []
  );

  const updatePreview = () => {
    const d = drag.current;
    const container = containerRef.current;
    if (!d || !container) return;

    // Auto-scroll a horizontally scrollable row near its edges.
    const box = container.getBoundingClientRect();
    if (container.scrollWidth > container.clientWidth) {
      if (d.lastX < box.left + EDGE_SCROLL_ZONE) container.scrollLeft -= 8;
      else if (d.lastX > box.right - EDGE_SCROLL_ZONE) container.scrollLeft += 8;
    }

    // Everything in layout (content) coordinates: offsetLeft ignores transforms.
    const center =
      d.startOffset + d.el.offsetWidth / 2 + (d.lastX - d.startX) + (container.scrollLeft - d.startScroll);
    const others = items().filter((el) => el.dataset.reorderId !== d.id);
    if (others.length === 0) return;
    const current = previewRef.current ?? [...orderRef.current];
    let next: string[] | null = null;
    for (const el of others) {
      if (center < el.offsetLeft + el.offsetWidth / 2) {
        next = moveBefore(current, d.id, el.dataset.reorderId!);
        break;
      }
    }
    if (!next) next = moveAfter(current, d.id, others[others.length - 1].dataset.reorderId!);
    if (!sameOrder(next, current)) {
      takeSnapshot();
      previewRef.current = next;
      setPreview(next);
    } else {
      applyDragTransform();
    }
  };

  const cancelPress = () => {
    clearTimer();
    press.current?.pressAnim?.cancel();
    press.current = null;
  };

  const startDrag = () => {
    const p = press.current;
    const container = containerRef.current;
    if (!p || !container) return;
    const from = p.pressAnim ? `scale(${PRESS_SCALE})` : "none";
    p.pressAnim?.cancel();
    p.pressAnim = null;
    // Finish any sibling shift so offsetLeft/visuals agree.
    const el = p.el;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transition = "none";
    drag.current = {
      id: p.id,
      el,
      startX: p.x,
      startScroll: container.scrollLeft,
      startOffset: el.offsetLeft,
      lastX: p.x
    };
    previewRef.current = [...orderRef.current];
    suppressClick.current = true;
    setDraggingId(p.id);
    setBusy(true);
    setPreview([...orderRef.current]);
    applyDragTransform();
    if (!prefersReducedMotion()) {
      el.animate([{ transform: from }, { transform: el.style.transform }], {
        duration: LIFT_MS,
        easing: EASE_OUT
      });
    }
    try {
      el.setPointerCapture(p.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  const onPointerDown = (id: string) => (e: React.PointerEvent<HTMLElement>) => {
    // Ignore secondary buttons and extra touch points once something is active.
    if (disabled || e.button !== 0 || press.current || drag.current) return;
    const el = e.currentTarget;
    const pressAnim = prefersReducedMotion()
      ? null
      : el.animate([{ transform: "scale(1)" }, { transform: `scale(${PRESS_SCALE})` }], {
          duration: delay,
          easing: "linear",
          fill: "forwards"
        });
    press.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, el, pressAnim };
    timer.current = window.setTimeout(() => {
      timer.current = null;
      startDrag();
    }, delay);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (d) {
      if (e.pointerId !== press.current?.pointerId) return;
      e.preventDefault();
      d.lastX = e.clientX;
      updatePreview();
      return;
    }
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (Math.abs(e.clientX - p.x) > MOVE_TOLERANCE || Math.abs(e.clientY - p.y) > MOVE_TOLERANCE) {
      cancelPress();
    }
  };

  const finish = (commit: boolean) => {
    const d = drag.current;
    if (!d) {
      cancelPress();
      return;
    }
    const next = previewRef.current;
    const el = d.el;
    const changed = !!next && !sameOrder(next, orderRef.current);
    if (commit && changed) {
      onCommitRef.current(next!);
    } else if (changed) {
      // Cancelled: back to the committed order; siblings FLIP back.
      takeSnapshot();
    }
    const liftMatch = /scale\(([\d.]+)\)/.exec(el.style.transform);
    const rect = el.getBoundingClientRect();
    pendingSettle.current = {
      el,
      center: rect.left + rect.width / 2,
      scale: liftMatch ? liftMatch[1] : "1"
    };

    drag.current = null;
    press.current = null;
    previewRef.current = null;
    clearTimer();
    setPreview(null);
    setDraggingId(null);

    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      el.style.transition = "";
      setBusy(false);
    }, SETTLE_MS + 40);

    // The click fired right after pointerup must not activate the item.
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerId !== press.current?.pointerId) return;
    finish(true);
  };

  const onPointerCancel = () => finish(false);

  const onClickCapture = (e: React.MouseEvent<HTMLElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const itemProps = (id: string) => ({
    "data-reorder-id": id,
    "data-dragging": draggingId === id ? "true" : undefined,
    onPointerDown: onPointerDown(id),
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
    onContextMenu: (e: React.MouseEvent) => {
      if (drag.current || timer.current !== null) e.preventDefault();
    }
  });

  return {
    containerRef,
    /** Order to render (live preview while dragging). */
    displayOrder: preview ?? [...order],
    draggingId,
    /** Dragging or settling: other layout animations should stand down. */
    busy,
    itemProps
  };
}

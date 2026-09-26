import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { popoverPosition } from "../lib/popoverPosition";

/** A body portal escapes card transforms, virtual lists and overflow clipping. */
export default function ViewportPopover({ x, y, children, className = "" }: {
  x: number; y: number; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const place = () => {
      const rect = menu.getBoundingClientRect();
      const next = popoverPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight);
      setPosition(prev => prev.x === next.x && prev.y === next.y ? prev : next);
    };
    place();
    // Inline AI groups, localized labels and folder lists can change menu size.
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [x, y]);
  return createPortal(
    <div ref={ref} className={`clipboard-item-context-menu viewport-popover ${className}`}
      style={{ left: position.x, top: position.y }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}>
      {children}
    </div>, document.body
  );
}

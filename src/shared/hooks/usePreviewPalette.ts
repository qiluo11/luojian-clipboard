import { useEffect, useState } from "react";
import { readPreviewPalette } from "../lib/richTextColors";

/** SVG images do not inherit app colors. Refresh their palette on theme changes,
 * including light/dark changes that do not change a memoized item's theme prop. */
export const usePreviewPalette = () => {
  const [palette, setPalette] = useState(readPreviewPalette);
  useEffect(() => {
    const update = () => {
      const next = readPreviewPalette();
      setPalette(prev => prev.foreground === next.foreground && prev.background === next.background ? prev : next);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    update();
    return () => observer.disconnect();
  }, []);
  return palette;
};

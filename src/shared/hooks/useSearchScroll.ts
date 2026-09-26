import { useCallback, useRef } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";

type UseSearchScrollOptions = {
  showSearchBox: boolean;
  setShowSearchBox: (val: boolean) => void;
  search: string;
  showSettings: boolean;
  showTagManager: boolean;
};

export const useSearchScroll = ({
  showSearchBox,
  setShowSearchBox,
  search,
  showSettings,
  showTagManager
}: UseSearchScrollOptions) => {
  const scrollTriggerRef = useRef(0);
  const listScrollTopRef = useRef(0);
  const topReachedTimeRef = useRef(0);

  const handleListScroll = useCallback((offset: number) => {
    if (offset === 0 && listScrollTopRef.current > 0) {
      topReachedTimeRef.current = Date.now();
    }
    listScrollTopRef.current = offset;
  }, []);

  const handleMainWheel = useCallback(
    (e: ReactWheelEvent<HTMLElement>) => {
      if (showSettings || showTagManager) return;

      // The search panel now lives in the header's normal flow (it pushes the
      // list down instead of overlaying it). While it is open, wheel gestures
      // must NOT drive its visibility any more: the old "scroll down to
      // collapse" branch raced with the panel's height animation and produced
      // the half-collapsed clipped look. Toggling is left to the header
      // button, the Alt+F hotkey and Esc/clear as before.
      if (showSearchBox || search.trim() !== "") {
        scrollTriggerRef.current = 0;
        return;
      }

      if (e.deltaY < -5 && (listScrollTopRef.current === 0 || isNaN(listScrollTopRef.current))) {
        if (Date.now() - topReachedTimeRef.current > 250) {
          scrollTriggerRef.current += Math.abs(e.deltaY);
          if (scrollTriggerRef.current > 45) {
            setShowSearchBox(true);
            scrollTriggerRef.current = 0;
          }
        } else {
          scrollTriggerRef.current = 0;
        }
      } else {
        scrollTriggerRef.current = 0;
      }
    },
    [
      showSettings,
      showTagManager,
      showSearchBox,
      search,
      setShowSearchBox
    ]
  );

  return {
    handleListScroll,
    handleMainWheel
  };
};

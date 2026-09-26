import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { hotkeyIdentity } from "../lib/hotkeyDisplay";

type HotkeyMode = "main" | "sequential" | "rich" | "search";

interface UseHotkeyConfigOptions {
  hotkey: string;
  setHotkey: (val: string) => void;
  sequentialHotkey: string;
  setSequentialHotkey: (val: string) => void;
  richPasteHotkey: string;
  setRichPasteHotkey: (val: string) => void;
  searchHotkey: string;
  setSearchHotkey: (val: string) => void;
  sequentialMode: boolean;
  isRecording: boolean;
  setIsRecording: (val: boolean) => void;
  isRecordingSequential: boolean;
  setIsRecordingSequential: (val: boolean) => void;
  isRecordingRich: boolean;
  setIsRecordingRich: (val: boolean) => void;
  isRecordingSearch: boolean;
  setIsRecordingSearch: (val: boolean) => void;
  t: (key: string) => string;
  pushToast: (msg: string, duration?: number) => number;
}

export const useHotkeyConfig = ({
  hotkey,
  setHotkey,
  sequentialHotkey,
  setSequentialHotkey,
  richPasteHotkey,
  setRichPasteHotkey,
  searchHotkey,
  setSearchHotkey,
  sequentialMode,
  isRecording,
  setIsRecording,
  isRecordingSequential,
  setIsRecordingSequential,
  isRecordingRich,
  setIsRecordingRich,
  isRecordingSearch,
  setIsRecordingSearch,
  t,
  pushToast
}: UseHotkeyConfigOptions) => {
  const checkHotkeyConflict = useCallback(
    (newHotkey: string, mode: HotkeyMode): boolean => {
      if (!newHotkey) return false;

      const conflicts = [];
      if (mode !== "main" && hotkeyIdentity(newHotkey) === hotkeyIdentity(hotkey)) conflicts.push(t("global_hotkey"));
      if (mode !== "sequential" && sequentialMode && hotkeyIdentity(newHotkey) === hotkeyIdentity(sequentialHotkey)) {
        conflicts.push(t("sequential_paste_hotkey_label"));
      }
      if (mode !== "rich" && hotkeyIdentity(newHotkey) === hotkeyIdentity(richPasteHotkey)) {
        conflicts.push(t("rich_paste_hotkey_label"));
      }
      if (mode !== "search" && hotkeyIdentity(newHotkey) === hotkeyIdentity(searchHotkey)) {
        conflicts.push(t("search_hotkey_label"));
      }

      if (conflicts.length > 0) {
        const msg = t("hotkey_conflict_toast").replace("{name}", conflicts[0]);
        pushToast(msg, 5000);
        return true;
      }
      return false;
    },
    [hotkey, sequentialMode, sequentialHotkey, richPasteHotkey, searchHotkey, t, pushToast]
  );

  // WebView keydown and the native hook can report the same chord concurrently.
  const savingRef = useRef(false);
  const activeModeRef = useRef<HotkeyMode | null>(null);
  activeModeRef.current = isRecording ? "main" : isRecordingSequential ? "sequential"
    : isRecordingRich ? "rich" : isRecordingSearch ? "search" : null;

  const update = useCallback(async (newHotkey: string, mode: HotkeyMode) => {
    if (savingRef.current) return;
    savingRef.current = true;
    if (activeModeRef.current === mode) activeModeRef.current = null;
    const config = {
      main: { current: hotkey, set: setHotkey, stop: setIsRecording, command: "register_hotkey", key: "hotkey" },
      sequential: { current: sequentialHotkey, set: setSequentialHotkey, stop: setIsRecordingSequential, command: "set_sequential_hotkey", key: "sequential_hotkey" },
      rich: { current: richPasteHotkey, set: setRichPasteHotkey, stop: setIsRecordingRich, command: "set_rich_paste_hotkey", key: "rich_paste_hotkey" },
      search: { current: searchHotkey, set: setSearchHotkey, stop: setIsRecordingSearch, command: "set_search_hotkey", key: "search_hotkey" }
    }[mode];
    try {
      // Re-recording the current binding is a successful no-op, not a new probe.
      if (hotkeyIdentity(newHotkey) === hotkeyIdentity(config.current)) return;
      if (checkHotkeyConflict(newHotkey, mode)) return;
      if (newHotkey && !await invoke<boolean>("test_hotkey_available", { hotkey: newHotkey })) {
        throw new Error(t("hotkey_register_failed"));
      }
      await invoke(config.command, { hotkey: newHotkey });
      // Do not optimistically display/save a binding rejected by the command.
      config.set(newHotkey);
      // Every setter registers and persists before reporting success.
    } catch (err) {
      pushToast(`${newHotkey}: ${err?.toString() || t("hotkey_register_failed")}`, 5000);
    } finally {
      config.stop(false);
      if (activeModeRef.current === mode) activeModeRef.current = null;
      savingRef.current = false;
    }
  }, [hotkey, sequentialHotkey, richPasteHotkey, searchHotkey, setHotkey,
    setSequentialHotkey, setRichPasteHotkey, setSearchHotkey, setIsRecording,
    setIsRecordingSequential, setIsRecordingRich, setIsRecordingSearch,
    checkHotkeyConflict, pushToast, t]);

  const updateHotkey = useCallback((key: string) => update(key, "main"), [update]);
  const updateSequentialHotkey = useCallback((key: string) => update(key, "sequential"), [update]);
  const updateRichPasteHotkey = useCallback((key: string) => update(key, "rich"), [update]);
  const updateSearchHotkey = useCallback((key: string) => update(key, "search"), [update]);

  useEffect(() => {
    invoke("set_recording_mode", {
      enabled: isRecording || isRecordingSequential || isRecordingRich
        || isRecordingSearch
    }).catch(console.error);

    if (isRecording || isRecordingSequential || isRecordingRich || isRecordingSearch) {
      const unlisten = listen<string>("hotkey-recorded", (event) => {
        const mode = activeModeRef.current;
        if (mode && !savingRef.current) void update(event.payload, mode);
      });

      const unlistenCancel = listen("recording-cancelled", () => {
        activeModeRef.current = null;
        setIsRecording(false);
        setIsRecordingSequential(false);
        setIsRecordingRich(false);
        setIsRecordingSearch(false);
      });

      return () => {
        unlisten.then((f) => f());
        unlistenCancel.then((f) => f());
      };
    }
  }, [
    isRecording,
    isRecordingSequential,
    isRecordingRich,
    isRecordingSearch,
    setIsRecording,
    setIsRecordingSequential,
    setIsRecordingRich,
    setIsRecordingSearch,
    update
  ]);

  return {
    checkHotkeyConflict,
    updateHotkey,
    updateSequentialHotkey,
    updateRichPasteHotkey,
    updateSearchHotkey
  };
};

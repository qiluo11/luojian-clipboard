import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import LanzouLink from "./LanzouLink";

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_url: string;
  release_name: string;
  notes: string;
  published_at: string;
}

/** Window event used by the settings page ("检查更新") to open the dialog directly. */
export const SHOW_UPDATE_EVENT = "luojian:show-update";

export const showUpdateDialog = (info: UpdateInfo) => {
  window.dispatchEvent(new CustomEvent<UpdateInfo>(SHOW_UPDATE_EVENT, { detail: info }));
};

interface UpdateDialogProps {
  t: (key: string) => string;
  theme: string;
}

type InstallPhase = "idle" | "downloading" | "installing" | "error";

interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

const toMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/**
 * In-app "new version" dialog with one-click update.
 *
 * "立即更新" calls `install_update`: the backend downloads the installer,
 * verifies its signature and installs it (the app closes and reopens).
 * Progress arrives through `update-progress` / `update-installing` events.
 *
 * A background check stores the result as a pending update; the dialog shows
 * the next time the window is opened: on startup, whenever the window regains
 * focus / becomes visible, or right away if the window is hidden when the
 * background check finishes.
 */
const UpdateDialog = ({ t, theme }: UpdateDialogProps) => {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<InstallPhase>("idle");
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0, total: null });
  const [error, setError] = useState("");
  const infoRef = useRef<UpdateInfo | null>(null);
  infoRef.current = info;

  const loadPending = useCallback(() => {
    if (infoRef.current) return;
    invoke<UpdateInfo | null>("get_pending_update")
      .then((pending) => {
        if (pending && pending.latest_version) setInfo(pending);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadPending();
    const onFocus = () => loadPending();
    const onVisibility = () => {
      if (document.visibilityState === "visible") loadPending();
    };
    const onShow = (e: Event) => {
      const detail = (e as CustomEvent<UpdateInfo>).detail;
      if (detail) {
        setPhase((p) => (p === "downloading" || p === "installing" ? p : "idle"));
        setInfo(detail);
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(SHOW_UPDATE_EVENT, onShow);

    let disposed = false;
    const unlisten = listen<UpdateInfo>("update-available", async (event) => {
      if (disposed || !event.payload) return;
      let visible = true;
      try {
        visible = await getCurrentWindow().isVisible();
      } catch {
        visible = false;
      }
      // Window hidden: prepare the dialog now so it is there when opened.
      // Window visible: don't interrupt; it shows on the next focus / open.
      if (!visible) setInfo(event.payload);
    });

    const unlistenProgress = listen<UpdateProgress>("update-progress", (event) => {
      if (disposed || !event.payload) return;
      setProgress({
        downloaded: event.payload.downloaded || 0,
        total: event.payload.total ?? null,
      });
    });
    const unlistenInstalling = listen("update-installing", () => {
      if (!disposed) setPhase("installing");
    });

    return () => {
      disposed = true;
      unlistenProgress.then((fn) => fn()).catch(() => {});
      unlistenInstalling.then((fn) => fn()).catch(() => {});
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(SHOW_UPDATE_EVENT, onShow);
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [loadPending]);

  if (!info) return null;

  const busy = phase === "downloading" || phase === "installing";

  const close = (skip: boolean) => {
    if (busy) return;
    const version = info.latest_version;
    setInfo(null);
    setPhase("idle");
    setError("");
    invoke("dismiss_update", { version, skip }).catch(console.error);
  };

  const installNow = () => {
    if (busy) return;
    setError("");
    setProgress({ downloaded: 0, total: null });
    setPhase("downloading");
    invoke("install_update")
      .then(() => setPhase("installing"))
      .catch((e) => {
        setError(String(e));
        setPhase("error");
      });
  };

  const ratio =
    progress.total && progress.total > 0
      ? Math.min(1, Math.max(0, progress.downloaded / progress.total))
      : 0;

  const statusText =
    phase === "installing"
      ? t("update_installing")
      : phase === "downloading"
        ? progress.total
          ? t("update_downloading")
              .replace("{done}", toMb(progress.downloaded))
              .replace("{total}", toMb(progress.total))
          : t("update_downloading_unknown").replace("{done}", toMb(progress.downloaded))
        : phase === "error"
          ? t("update_install_failed").replace("{e}", error)
          : "";

  return (
    <div className="modal-overlay update-dialog-overlay">
      <div
        className={`confirm-dialog update-dialog theme-${theme}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        aria-busy={busy}
      >
        <div className="confirm-dialog-title" id="update-dialog-title">
          {t("update_available_title")}
        </div>
        <div className="confirm-dialog-message">
          <div className="update-dialog-versions">
            {t("update_available_versions")
              .replace("{current}", info.current_version)
              .replace("{latest}", info.latest_version)}
          </div>
          {info.notes && <div className="update-dialog-notes">{info.notes}</div>}
          {phase !== "idle" && (
            <div className={`update-dialog-status is-${phase}`} role="status" aria-live="polite">
              {phase === "downloading" && (
                <div className="update-dialog-progress" aria-hidden="true">
                  <div
                    className={`update-dialog-progress-bar${progress.total ? "" : " is-unknown"}`}
                    style={{ transform: `scaleX(${progress.total ? ratio : 1})` }}
                  />
                </div>
              )}
              <div className="update-dialog-status-text">{statusText}</div>
            </div>
          )}
          <div className="update-dialog-mirror">
            {t("update_lanzou_hint")}
            <LanzouLink t={t} />
          </div>
        </div>
        {!busy && (
          <div className="confirm-dialog-buttons">
            <button type="button" className="confirm-dialog-button" onClick={() => close(true)}>
              {t("update_skip_version")}
            </button>
            <button
              type="button"
              className="confirm-dialog-button"
              onClick={() => {
                invoke("open_release_page", { url: info.release_url }).catch(console.error);
                close(false);
              }}
            >
              {t("update_go_download")}
            </button>
            <button
              type="button"
              className="confirm-dialog-button primary update-dialog-install"
              onClick={installNow}
            >
              {t("update_install_now")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default UpdateDialog;

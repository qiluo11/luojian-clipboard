type AudioContextCtor = typeof AudioContext;

let sharedCtx: AudioContext | null = null;
let unlockBound = false;

const getAudioContextCtor = (): AudioContextCtor | null => {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ||
    null
  );
};

export const getSoundAudioContext = (): AudioContext | null => {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;

  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new Ctor();
  }
  return sharedCtx;
};

/** Resume Web Audio after a user gesture (required on macOS WKWebView). */
export const unlockSoundAudioContext = async (): Promise<void> => {
  const ctx = getSoundAudioContext();
  if (!ctx || ctx.state === "running") return;

  try {
    await ctx.resume();
  } catch {
    // ignore — will retry on next gesture
  }

  if (ctx.state === "closed") return;

  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    source.stop(0);
  } catch {
    // silent priming is best-effort
  }
};

export const ensureSoundAudioRunning = async (): Promise<boolean> => {
  const ctx = getSoundAudioContext();
  if (!ctx) return false;
  if (ctx.state === "running") return true;
  if (ctx.state === "closed") return false;

  try {
    await ctx.resume();
  } catch {
    return false;
  }
  return ctx.state !== "suspended" && ctx.state !== "closed";
};

export const bindSoundAudioUnlock = (): void => {
  if (unlockBound || typeof document === "undefined") return;
  unlockBound = true;

  const onGesture = () => {
    void unlockSoundAudioContext();
  };

  document.addEventListener("pointerdown", onGesture, true);
  document.addEventListener("keydown", onGesture, true);
};

// Turning captions on, exactly once.
//
// FIELD 2026-10-19 (demo rehearsal): in a spec session two things switch
// captions on at the same moment — the session itself and the PRD agent,
// which needs captions to hear anything. Both saw "off", both started a
// recogniser, and Chrome only allows one Web Speech recogniser per page: each
// start aborted the other, every 300ms, forever. Captions never showed a word.
//
// So starting is single-flight. While a start is in flight or running, another
// "on" is a no-op. A stop invalidates whatever start is still in flight (its
// result is torn down when it lands), and a start always stops anything still
// running before it takes over.

export type Stopper = () => void;

export type CaptionController = {
  /** Idempotent: starts unless already on or starting. Returns whether this call started it. */
  enable: () => boolean;
  /** Stops whatever is running and cancels a start still in flight. */
  disable: () => void;
  toggle: () => void;
  /** Swap the running engine (e.g. a fallback), stopping the old one first. */
  replace: (next: Stopper | null) => void;
  isOn: () => boolean;
};

/** `start(isCurrent)` resolves to the stopper for what it started (or null if
 *  nothing could start). `isCurrent()` tells it whether it has been superseded. */
export function createCaptionController(
  start: (isCurrent: () => boolean) => Promise<Stopper | null>,
  onState?: (on: boolean) => void
): CaptionController {
  let wanted = false;
  let gen = 0;
  let running: Stopper | null = null;

  const stopRunning = () => {
    const s = running;
    running = null;
    try { s?.(); } catch { /* a stop that throws must not keep captions half-on */ }
  };

  const enable = () => {
    if (wanted) return false;
    wanted = true;
    const my = ++gen;
    onState?.(true);
    const isCurrent = () => wanted && gen === my;
    stopRunning();
    start(isCurrent).then(
      (stop) => {
        if (!isCurrent()) { try { stop?.(); } catch {} return; }
        if (!stop) { wanted = false; onState?.(false); return; }
        stopRunning();
        running = stop;
      },
      () => {
        if (isCurrent()) { wanted = false; onState?.(false); }
      }
    );
    return true;
  };

  const disable = () => {
    if (!wanted && !running) return;
    wanted = false;
    gen++;
    stopRunning();
    onState?.(false);
  };

  return {
    enable,
    disable,
    toggle: () => (wanted ? disable() : void enable()),
    replace: (next) => {
      if (!wanted) { try { next?.(); } catch {} return; }
      stopRunning();
      running = next;
    },
    isOn: () => wanted,
  };
}

/**
 * MAYA GUARD — where a control belongs.
 *
 * Maya asks: "Why are three buttons I never press sitting on top of the face
 * of the person talking?"
 *
 * FIELD 2026-08-20, from a screenshot of a live meeting: Raise hand / Be
 * right back / React floated in a pill across the middle-bottom of the
 * video, on every screen, all meeting, whether anybody used them or not.
 *
 * Run: node lib/dock.test.mjs
 */
import { readFileSync } from "node:fs";
import { BAR, SCREEN_SHARE, dockAnchor, overlayWanted, DOCK_CONTROLS, showLabels, LABELS_MIN_PX } from "./dock.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

/** A DOM small enough to reason about: the stock LiveKit bar. */
function makeBar(withShare = true) {
  const kids = [];
  const bar = {
    firstChild: null,
    querySelector: (sel) => (sel === SCREEN_SHARE && withShare ? share : null),
    kids,
  };
  const mk = (name) => ({ name, parentNode: bar, nextSibling: null });
  const mic = mk("mic-group"), cam = mk("cam-group"), share = mk("share"),
        chat = mk("chat"), leave = mk("leave");
  // the real bar wraps mic/camera in .lk-button-group
  const shareInner = { name: "share-inner", parentNode: share, nextSibling: null };
  share.querySelector = () => null;
  const order = [mic, cam, share, chat, leave];
  order.forEach((n, i) => { n.nextSibling = order[i + 1] || null; kids.push(n); });
  bar.firstChild = mic;
  bar.querySelector = (sel) => (sel === SCREEN_SHARE && withShare ? shareInner : null);
  return { bar, order, share, shareInner, chat, leave, mic };
}

{
  const { bar, chat } = makeBar(true);
  const a = dockAnchor(bar);
  ok(a.ok === true, "with a control bar present, there is somewhere to dock");
  ok(a.before === chat,
    "we land immediately AFTER screen share — the place a person already looks for meeting controls");
}
{
  const { bar, shareInner, share } = makeBar(true);
  // the toggle is nested inside a group; we must splice at the bar's own
  // child, not inside somebody else's group
  ok(shareInner.parentNode === share && dockAnchor(bar).before !== shareInner,
    "a toggle nested in .lk-button-group is walked up to the bar's own child — we sit between siblings, never inside a group");
}
{
  const { bar, mic } = makeBar(false);
  const a = dockAnchor(bar);
  ok(a.ok === true && a.before === mic,
    "no screen-share button (Safari on iOS) → the FRONT of the bar, never after Leave: a control past Leave is one nobody finds and some press by accident on their way out");
}
ok(dockAnchor(null).ok === false, "no bar yet is not a crash — the bar is rendered after we mount");
ok(BAR === ".lk-control-bar" && /data-lk-source/.test(SCREEN_SHARE),
  "we address LiveKit's public DOM contract, not a class we guessed");

// ── what is allowed over the video ───────────────────────────────────────
ok(overlayWanted({ hands: 0, away: 0, floaters: 0 }) === false,
  "nothing happening → nothing over the picture. This is the whole fix.");
ok(overlayWanted({ hands: 1, away: 0, floaters: 0 }) === true,
  "a hand actually up earns the overlay — the point of raising your hand is being seen");
ok(overlayWanted({ hands: 0, away: 0, floaters: 2 }) === true, "reactions in flight earn it too, while they fly");

ok(DOCK_CONTROLS.length === 3 && DOCK_CONTROLS.every((c) => c.glyph && c.on && c.off),
  "three controls, each with a glyph and both states — the label changes when the state does");
ok(showLabels(1440) === true && showLabels(600) === false,
  "labels drop on a narrow window: a wrapped control bar is how the Leave button ended up off-screen once already");
ok(LABELS_MIN_PX >= 600, "the threshold leaves room for LiveKit's own five buttons plus ours");

// ── the component honours it ─────────────────────────────────────────────
const conf = readFileSync(new URL("../app/room/[room]/Conference.tsx", import.meta.url), "utf8");
ok(/createPortal\(/.test(conf) && /dockAnchor\(bar\)/.test(conf),
  "the controls are portalled into the real bar using the guarded anchor");
ok(!/qmr-reactdock/.test(conf),
  "the floating pill that sat over the speaker's chest is gone");
ok(!/\.qmr-hold\b/.test(conf), "…and so is its CSS, rather than left behind to be re-used by accident");
ok(/MutationObserver/.test(conf),
  "the bar is re-rendered when someone shares a screen; an observer keeps us docked instead of silently vanishing");
ok(/node\?\.parentNode\?\.removeChild\(node\)/.test(conf),
  "and the dock removes itself on unmount — a portal host left in the DOM is a leak that accumulates every layout change");
ok(/qmr-held/.test(conf),
  "raised hands still get their own place over the video — STATE is allowed there, controls are not");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

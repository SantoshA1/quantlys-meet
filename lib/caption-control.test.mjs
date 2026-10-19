// node --experimental-strip-types lib/caption-control.test.mjs
import { createCaptionController } from "./caption-control.ts";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} - ${m}`); };
const tick = () => new Promise((r) => setTimeout(r, 0));

{
  // Two starters in the same tick (spec session + PRD agent): one engine.
  let starts = 0, live = 0, stops = 0;
  const states = [];
  const c = createCaptionController(async () => {
    starts++; live++;
    await tick();
    return () => { live--; stops++; };
  }, (on) => states.push(on));
  const a = c.enable();
  const b = c.enable();
  c.enable();
  await tick(); await tick();
  ok(a === true && b === false, "second enable while starting is a no-op");
  ok(starts === 1 && live === 1, "exactly one recogniser is started");
  ok(c.isOn(), "and captions are on");
  c.enable();
  await tick();
  ok(starts === 1, "enable when already on is a no-op");
  c.toggle();
  ok(live === 0 && stops === 1 && !c.isOn(), "toggle off stops the one engine");
  ok(states.join(",") === "true,false", "state flips on once and off once");
}

{
  // Stop while the start is still in flight: the late engine is torn down.
  let live = 0;
  let release;
  const c = createCaptionController(() => new Promise((r) => { release = () => { live++; r(() => { live--; }); }; }));
  c.enable();
  c.disable();
  release();
  await tick();
  ok(live === 0 && !c.isOn(), "a start that lands after stop is stopped, not leaked");
}

{
  // Off then on quickly: only the latest start survives.
  let live = 0;
  const releases = [];
  const c = createCaptionController(() => new Promise((r) => { releases.push(() => { live++; r(() => { live--; }); }); }));
  c.enable(); c.disable(); c.enable();
  releases.forEach((f) => f());
  await tick();
  ok(live === 1 && c.isOn(), "off→on keeps exactly one engine");
  c.disable();
  ok(live === 0, "and stopping clears it");
}

{
  // Nothing could start (no recogniser): state returns to off.
  const states = [];
  const c = createCaptionController(async () => null, (on) => states.push(on));
  c.enable();
  await tick();
  ok(!c.isOn() && states.join(",") === "true,false", "a start that finds no engine turns itself off");
  ok(c.enable() === true, "and can be tried again");
}

{
  // Fallback swap stops the old engine first.
  let a = 0, b = 0;
  const c = createCaptionController(async () => { a++; return () => { a--; }; });
  c.enable();
  await tick();
  c.replace(() => { b--; }); b++;
  ok(a === 0 && b === 1, "replace stops the old engine before the fallback runs");
  c.disable();
  ok(b === 0, "and disable stops the fallback");
}

{
  // A start that throws does not wedge captions on.
  const c = createCaptionController(async () => { throw new Error("boom"); });
  c.enable();
  await tick();
  ok(!c.isOn(), "a failed start leaves captions off, not stuck 'starting'");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

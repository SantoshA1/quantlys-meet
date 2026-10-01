// The whiteboard, readable from the part of the room that saves the meeting.
//
// FIELD 2026-08-25: the board's strokes have to reach the recording payload,
// and Board and RoomHeader are SIBLINGS in the tree — both under LiveKitRoom,
// neither able to see the other's state. The alternatives were threading a
// context around LiveKit's own children, or having the header re-subscribe to
// the board's data channel and rebuild the whole board a second time.
//
// A module-scoped handoff is smaller than either and honest about what it is:
// one page, one module instance, one value. The same file already does this
// with AUDIO_SOURCES for the recorder's media-element sources.
//
// It holds a SNAPSHOT, never a subscription. Nothing here re-renders anything.

import type { Stroke } from "./draw";

let strokes: Stroke[] = [];
let at = 0;
/** Which surface the pen is on right now — drives recording composite. */
let surface: "screen" | "board" | "none" = "none";

export function setBoardStrokes(next: Stroke[]) {
  strokes = Array.isArray(next) ? next : [];
  at = Date.now();
}

export function getBoardStrokes(): Stroke[] {
  return strokes;
}

export function setBoardSurface(next: "screen" | "board" | "none") {
  surface = next === "screen" || next === "board" ? next : "none";
}

export function getBoardSurface(): "screen" | "board" | "none" {
  return surface;
}

/** When the board last changed — so a meeting where nobody drew can be told
 *  apart from one where the handoff failed. */
export function boardTouchedAt(): number {
  return at;
}

/** A new meeting must not inherit the last one's diagram. */
export function clearBoardStrokes() {
  strokes = [];
  at = 0;
  surface = "none";
}

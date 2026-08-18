// Retired. See app/meeting/[room]/page.tsx — there is exactly one room now,
// at /room/[room], and this path redirects to it.
//
// Kept as a re-export rather than left as a second copy of the meeting: a
// duplicate room is a second place for every future fix to fail to land, and
// this one had already drifted far enough to lose the microphone watchdog,
// captions, recording and the waiting room.
export { default } from "@/app/room/[room]/Conference";

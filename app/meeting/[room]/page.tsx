// FIELD 2026-08-18 (Conclave round 40): this app had TWO room implementations.
//
// `/room/[room]` is the real one — device check, the microphone watchdog,
// captions, reactions, recording, notes, the waiting room. `/meeting/[room]`
// was an earlier draft still wired to `<LiveKitRoom connect video audio />`,
// the hello-world mount whose failure mode is a person talking to a room that
// cannot hear them. It even carried a type error nobody had hit yet.
//
// Nothing linked to it except /standup — which is exactly how a trapdoor
// works. One meeting somebody joins from a shortcut is a meeting on the worse
// code, and nobody will ever connect the two.
//
// Two implementations of the same screen is not redundancy. It is a second
// place for every future fix to fail to land.

import { redirect } from "next/navigation";

export default function MeetingRedirect({ params }: { params: { room: string } }) {
  redirect(`/room/${encodeURIComponent(params.room)}`);
}

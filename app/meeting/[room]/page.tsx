// The old room had no participant names, no chat and no Record button, and
// links to it are already out in the world. Forward every one of them to the
// room that has all three, so a shared link never lands somewhere worse.

import { redirect } from "next/navigation";

export default function OldMeetingRoute({ params }: { params: { room: string } }) {
  redirect(`/room/${params.room}`);
}

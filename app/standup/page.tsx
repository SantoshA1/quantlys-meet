"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Standup() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  useEffect(() => { (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace("/?next=/standup"); return; }   // logged-in link, not the guest link
    const today = new Date().toISOString().slice(0, 10);
    const room = `standup-${today}`;
    // upsert avoids the two-first-arrivals race two drafts had
    await supabase.from("meetings")
      .upsert({ room_name: room, title: `Standup ${today}`, created_by: user.id, active: true },
               { onConflict: "room_name" });
    // One room. /meeting/ was a second, older implementation of the same
    // screen and joining a standup through it silently lost the device
    // check, the microphone watchdog, captions and recording.
    router.replace(`/room/${room}`);
  })(); }, []);
  return <div className="wrap"><div className="card">Opening today's standup…</div></div>;
}

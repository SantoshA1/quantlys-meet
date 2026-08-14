"use client";
import {
  LiveKitRoom, GridLayout, ParticipantTile, RoomAudioRenderer,
  ControlBar, useTracks, useConnectionQualityIndicator,
} from "@livekit/components-react";
import { Track, ConnectionQuality } from "livekit-client";
import { useParams } from "next/navigation";

function QualityBar() {
  const { quality } = useConnectionQualityIndicator();
  const bars = quality === ConnectionQuality.Excellent ? 3
    : quality === ConnectionQuality.Good ? 2
    : quality === ConnectionQuality.Poor ? 1 : 0;
  const color = bars >= 3 ? "#3fb27f" : bars === 2 ? "#e8d48b" : "#e5484d";
  return (
    <div className="quality-bar" title={`Connection: ${ConnectionQuality[quality]}`}
      style={{ position: "absolute", top: 6, right: 6, height: 14 }}>
      {[8, 11, 14].map((h, i) => (
        <span key={i} style={{ height: h, background: i < bars ? color : "#3a3f4b" }} />
      ))}
    </div>
  );
}

function Stage() {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true },
     { source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: false }
  );
  return (
    <GridLayout tracks={tracks} style={{ height: "calc(100vh - 60px)" }}>
      <div style={{ position: "relative" }}>
        <ParticipantTile />
        <QualityBar />
      </div>
    </GridLayout>
  );
}

export default function Room({ token, title }: { token: string; title: string }) {
  const { room } = useParams<{ room: string }>();
  const guestLink = typeof window !== "undefined"
    ? `${window.location.origin}/meeting/${room}?guest=1&title=${encodeURIComponent(title)}`
    : "";

  return (
    <div className="meeting-stage">
      <div className="row" style={{ padding: "8px 12px", justifyContent: "space-between" }}>
        <b>{title}</b>
        <button className="ghost" onClick={() => navigator.clipboard.writeText(guestLink)}>
          Copy guest link
        </button>
      </div>
      <LiveKitRoom
        token={token}
        serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
        connect
        video
        audio
        style={{ height: "calc(100vh - 44px)" }}
      >
        <Stage />
        <RoomAudioRenderer />
        {/* ControlBar gives mic/cam toggle + screen share + leave.
            Auto-reconnect is handled silently by LiveKit by default. */}
        <ControlBar variation="minimal" />
      </LiveKitRoom>
    </div>
  );
}

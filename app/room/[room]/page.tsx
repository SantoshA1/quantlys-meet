import Conference from "./Conference";
import { acceptSessionMode, type SessionMode } from "@/lib/memory";

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

export default function RoomPage({
  params,
  searchParams,
}: {
  params: { room: string };
  searchParams?: {
    spec?: string | string[];
    mode?: string | string[];
    memory?: string | string[];
  };
}) {
  const rawSpec = first(searchParams?.spec);
  const spec = rawSpec === "1" || rawSpec === "true";
  const memoryFlag = first(searchParams?.memory);
  const modeHint =
    first(searchParams?.mode) ||
    (memoryFlag === "1" || memoryFlag === "true" ? "memory" : "");
  const initialSessionMode: SessionMode = acceptSessionMode(modeHint);
  return (
    <Conference
      room={params.room}
      spec={spec}
      initialSessionMode={initialSessionMode}
    />
  );
}

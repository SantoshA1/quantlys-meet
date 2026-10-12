import Conference from "./Conference";
import { acceptSessionMode, type SessionMode } from "@/lib/memory";

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ room: string }>;
  searchParams?: Promise<{
    spec?: string | string[];
    mode?: string | string[];
    memory?: string | string[];
  }>;
}) {
  const { room } = await params;
  const sp = (await searchParams) ?? {};
  const rawSpec = first(sp.spec);
  const spec = rawSpec === "1" || rawSpec === "true";
  const memoryFlag = first(sp.memory);
  const modeHint =
    first(sp.mode) ||
    (memoryFlag === "1" || memoryFlag === "true" ? "memory" : "");
  const initialSessionMode: SessionMode = acceptSessionMode(modeHint);
  return (
    <Conference
      room={room}
      spec={spec}
      initialSessionMode={initialSessionMode}
    />
  );
}

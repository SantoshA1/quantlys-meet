import Conference from "./Conference";

export default function RoomPage({
  params,
  searchParams,
}: {
  params: { room: string };
  searchParams?: { spec?: string | string[] };
}) {
  const raw = searchParams?.spec;
  const v = Array.isArray(raw) ? raw[0] : raw;
  const spec = v === "1" || v === "true";
  return <Conference room={params.room} spec={spec} />;
}

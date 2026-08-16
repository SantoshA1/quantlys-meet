import Conference from "./Conference";

export default function RoomPage({ params }: { params: { room: string } }) {
  return <Conference room={params.room} />;
}

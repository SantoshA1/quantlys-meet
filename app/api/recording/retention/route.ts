// How long recordings live, so the history can print a truthful delete date.
// Just the number — the cron owns the deleting; this only reports the policy.
export const dynamic = "force-dynamic";
export async function GET() {
  const days = Number(process.env.RECORDING_RETENTION_DAYS);
  return Response.json({ days: Number.isFinite(days) && days > 0 ? Math.floor(days) : 0 });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = /* cookie-based server client */;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: rec } = await supabase
    .from("recordings").select("id, storage_prefix, meetings(created_by)")
    .eq("id", params.id).single();
  if (!rec) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const videoUrl = await getSignedUrl(s3Client,
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: `${rec.storage_prefix}/room.mp4` }),
    { expiresIn: 3600 });

  const { data: segments } = await supabase
    .from("transcripts").select("speaker_name, ts_start, ts_end, text_original")
    .eq("recording_id", params.id).order("ts_start");

  return NextResponse.json({ videoUrl, segments });
}

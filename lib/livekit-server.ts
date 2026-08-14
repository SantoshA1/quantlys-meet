import { EgressClient } from "livekit-server-sdk";

export const egressClient = new EgressClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

export const s3Config = {
  accessKey: process.env.S3_ACCESS_KEY!,
  secret: process.env.S3_SECRET_KEY!,
  region: process.env.S3_REGION!,
  endpoint: process.env.S3_ENDPOINT!,
  bucket: process.env.S3_BUCKET!,
};

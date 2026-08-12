"use node";

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getS3Client() {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing Cloudflare R2 credentials. Please configure CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, and CLOUDFLARE_R2_SECRET_ACCESS_KEY."
    );
  }

  return new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    region: "auto",
  });
}

function getBucketName() {
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("Missing CLOUDFLARE_R2_BUCKET_NAME environment variable.");
  }
  return bucketName;
}

export const getDownloadUrl = action({
  args: {
    r2Key: v.string(),
    filename: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      const s3 = getS3Client();
      const bucket = getBucketName();

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: args.r2Key,
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent(args.filename)}"`,
      });

      // Url expires in 1 hour
      const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
      return url;
    } catch (error) {
      console.error("Failed to generate pre-signed R2 URL", error);
      throw new Error(`Failed to generate download link: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

export const uploadFile = internalAction({
  args: {
    base64Data: v.string(), // base64 string without data: prefix
    mimeType: v.string(),
    filename: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      const s3 = getS3Client();
      const bucket = getBucketName();

      const buffer = Buffer.from(args.base64Data, "base64");
      const fileExtension = args.filename.split(".").pop() || "";
      const uniqueKey = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileExtension}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: uniqueKey,
          Body: buffer,
          ContentType: args.mimeType,
        })
      );

      return {
        r2Key: uniqueKey,
        size: buffer.length,
      };
    } catch (error) {
      console.error("Failed to upload to Cloudflare R2", error);
      throw new Error(`R2 Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

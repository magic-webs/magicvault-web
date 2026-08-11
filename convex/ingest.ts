"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, embedMany } from "ai";
import { z } from "zod";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
// @ts-ignore
import pdf from "pdf-parse-fork";

function chunkText(text: string, chunkSize = 800, overlap = 200): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
    if (chunkSize - overlap <= 0) break;
  }
  return chunks;
}

async function downloadFromR2(r2Key: string): Promise<Buffer> {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("Missing Cloudflare R2 credentials/configuration.");
  }

  const s3 = new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    region: "auto",
  });

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: r2Key,
    })
  );

  const byteArray = await response.Body?.transformToByteArray();
  if (!byteArray) {
    throw new Error("Empty body received from Cloudflare R2 download.");
  }
  return Buffer.from(byteArray);
}

export const processDocument = internalAction({
  args: {
    documentId: v.id("documents"),
    userId: v.id("users"),
    r2Key: v.string(),
    mimeType: v.string(),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error("Missing OPENAI_API_KEY environment variable.");
    }

    const openai = createOpenAI({ apiKey: openaiApiKey });

    let extractedText = "";
    let isTextExtractable = true;

    try {
      // 1. Download file from R2
      const fileBuffer = await downloadFromR2(args.r2Key);

      // 2. Text extraction
      if (args.mimeType === "application/pdf") {
        const parsed = await pdf(fileBuffer);
        extractedText = parsed.text || "";
      } else if (args.mimeType.startsWith("image/")) {
        const base64Data = fileBuffer.toString("base64");
        // Run OCR using OpenAI Multimodal vision
        const response = await generateObject({
          model: openai("gpt-4o-mini"),
          schema: z.object({
            text: z.string().describe("All readable text extracted from the image"),
          }),
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Please perform OCR on this document image and extract all text content exactly as written. Output in the schema.",
                },
                {
                  type: "image",
                  image: `data:${args.mimeType};base64,${base64Data}`,
                },
              ],
            },
          ],
        });
        extractedText = response.object.text;
      } else {
        // Default text file parsing
        extractedText = fileBuffer.toString("utf-8");
      }

      extractedText = extractedText.trim();
      if (!extractedText) {
        isTextExtractable = false;
        extractedText = `This is an uploaded document named ${args.filename}. Direct text content is not select-copyable or readable.`;
      }

      // 3. Generate structured details
      const detailsResponse = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: z.object({
          title: z.string().describe("A clean title for the document"),
          category: z.string().describe("Invoice, receipt, ID card, certificate, manual, personal, or work"),
          summary: z.string().describe("A 1-to-2 sentence summary of what this document contains"),
          tags: z.array(z.string()).describe("A list of 3-5 keywords or tags"),
        }),
        prompt: isTextExtractable
          ? `Analyze the following extracted text from a document (filename: "${args.filename}") and generate metadata:\n\n${extractedText.slice(0, 10000)}`
          : `Generate metadata for an uploaded document with filename "${args.filename}" that has no selectable text.`,
      });

      const { title, category, summary, tags } = detailsResponse.object;

      // 3. Chunk text and generate embeddings
      const chunks = chunkText(extractedText);
      
      const { embeddings } = await embedMany({
        model: openai.embedding("text-embedding-3-small"),
        values: chunks,
      });

      // 4. Save chunks
      const chunkRecords = chunks.map((text, idx) => ({
        text,
        embedding: embeddings[idx],
      }));

      await ctx.runMutation(internal.documents.insertChunks, {
        documentId: args.documentId,
        userId: args.userId,
        chunks: chunkRecords,
      });

      // 5. Update document details
      const extension = args.filename.split(".").pop() || "";
      const cleanTitle = title.trim().replace(/[^a-zA-Z0-9]/g, "_");
      const cleanFilename = `${cleanTitle}.${extension}`;

      await ctx.runMutation(internal.documents.updateDocumentDetails, {
        documentId: args.documentId,
        title,
        filename: cleanFilename,
        category,
        summary,
        tags,
        status: "ready",
      });

      return { success: true };
    } catch (error) {
      console.error("Ingestion failed", error);
      const failureReason = error instanceof Error ? error.message : String(error);
      
      await ctx.runMutation(internal.documents.updateDocumentDetails, {
        documentId: args.documentId,
        title: args.filename,
        category: "Failed Ingestion",
        summary: "Ingestion failed.",
        tags: [],
        status: "failed",
        failureReason,
      });

      return { success: false, error: failureReason };
    }
  },
});

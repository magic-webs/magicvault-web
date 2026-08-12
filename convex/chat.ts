"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output, embed } from "ai";
import { z } from "zod";

async function transcribeAudio(base64Audio: string, mimeType: string, apiKey: string): Promise<string> {
  const buffer = Buffer.from(base64Audio, "base64");
  const formData = new FormData();

  const ext = mimeType.split("/")[1]?.split(";")[0] || "webm";
  const blob = new Blob([buffer], { type: mimeType });
  formData.append("file", blob, `audio.${ext}`);
  formData.append("model", "whisper-1");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper transcription failed: ${errorText}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text;
}

export const simulate = action({
  args: {
    kind: v.union(v.literal("text"), v.literal("voice"), v.literal("upload")),
    whatsappNumber: v.string(),
    text: v.optional(v.string()),
    audio: v.optional(
      v.object({
        base64: v.string(),
        mimeType: v.string(),
      })
    ),
    file: v.optional(
      v.object({
        base64: v.string(),
        mimeType: v.string(),
        filename: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<any> => {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error("Missing OPENAI_API_KEY environment variable.");
    }

    const openai = createOpenAI({ apiKey: openaiApiKey });

    // 1. Identify user
    const user = await ctx.runQuery(internal.chat_db.getUserByPhone, {
      whatsappNumber: args.whatsappNumber,
    });

    if (!user) {
      return {
        inbound: { kind: args.kind },
        replies: [
          {
            type: "text",
            text: "Welcome to Magic Vault! No account was found for your phone number. Please sign up or sign in on the web interface to get started.",
          },
        ],
      };
    }

    // 2. Handle File Ingestion Flow
    if (args.kind === "upload" && args.file) {
      const filename = args.file.filename || "Uploaded_Document";

      // Upload file to R2
      const uploadResult = await ctx.runAction(internal.r2.uploadFile, {
        base64Data: args.file.base64,
        mimeType: args.file.mimeType,
        filename,
      });

      // Create document entry in Convex
      const docId = await ctx.runMutation(internal.documents.createDocumentInternal, {
        userId: user._id,
        filename,
        mimeType: args.file.mimeType,
        size: uploadResult.size,
        r2Key: uploadResult.r2Key,
      });

      // Bypassing mutation token check in background action by running internally
      // Wait, let's make sure creating document is bypassable or we pass user context!
      // Ah, the mutation api.documents.createDocument checks for token. But inside the simulation, we already know the user!
      // Let's create an internalMutation or change createDocument to take userId when run internally, or we can just bypass it.
      // Wait! Let's write an internalMutation in documents.ts called `createDocumentInternal` so we don't need a token check!
      // This is much cleaner. We will add `createDocumentInternal` in documents.ts or execute it here.
      // Wait, let's handle the background ingestion task using scheduler:
      await ctx.scheduler.runAfter(0, internal.ingest.processDocument, {
        documentId: docId,
        userId: user._id,
        r2Key: uploadResult.r2Key,
        mimeType: args.file.mimeType,
        filename,
      });

      const downloadUrl: string = await ctx.runAction(api.r2.getDownloadUrl, {
        r2Key: uploadResult.r2Key,
        filename,
      });

      return {
        inbound: { kind: "upload", downloadUrl },
        replies: [
          {
            type: "text",
            text: `📥 Document "${filename}" received! I am currently uploading, summarizing, and indexing it in your vault. It will show up under Saved Documents shortly.`,
          },
        ],
      };
    }

    // 3. Handle Voice or Text Queries
    let queryText = args.text || "";
    let transcript: string | undefined;

    if (args.kind === "voice" && args.audio) {
      try {
        transcript = await transcribeAudio(args.audio.base64, args.audio.mimeType, openaiApiKey);
        queryText = transcript;
      } catch (err) {
        console.error("Transcription error", err);
        return {
          inbound: { kind: "voice" },
          replies: [{ type: "text", text: "⚠️ Sorry, I could not transcribe your voice message. Please try again or send a text." }],
        };
      }
    }

    queryText = queryText.trim();
    if (!queryText) {
      return {
        inbound: { kind: args.kind, transcript },
        replies: [{ type: "text", text: "Please send a valid message or voice note." }],
      };
    }

    // 4. Vector Search (RAG)
    let contextText = "";
    let matchedDocs: Array<{ id: string; filename: string; mimeType: string; summary: string; r2Key: string }> = [];
    try {
      const { embedding } = await embed({
        model: openai.embedding("text-embedding-3-small"),
        value: queryText,
      });

      const matches = await ctx.vectorSearch("chunks", "by_embedding", {
        vector: embedding,
        limit: 5,
        filter: (q) => q.eq("userId", user._id),
      });

      if (matches.length > 0) {
        const chunkIds = matches.map((m) => m._id);
        const results: any[] = await ctx.runQuery(internal.chat_db.getChunksWithDocs, { chunkIds });
        contextText = results.map((r: any) => `[Document: ${r.filename} (ID: ${r.documentId})]\n${r.text}`).join("\n\n---\n\n");

        // Unique documents
        const seen = new Set();
        for (const r of results) {
          if (!seen.has(r.documentId)) {
            seen.add(r.documentId);
            matchedDocs.push({
              id: r.documentId,
              filename: r.filename,
              mimeType: r.mimeType,
              summary: r.summary,
              r2Key: r.r2Key,
            });
          }
        }
      }
    } catch (err) {
      console.error("Vector search or embedding error", err);
    }

    // 5. Ask model with Vercel AI SDK
    const documentsPromptContext = matchedDocs
      .map((d) => `- Document ID: "${d.id}", Filename: "${d.filename}", Summary: "${d.summary}"`)
      .join("\n");

    const systemPrompt = `You are Magic Vault, a highly advanced personal document assistant.
You help users retrieve and remember information from the documents they uploaded.
When answering, you MUST use the provided context from the user's vault documents if it is relevant.
If the context contains the answer, answer concisely and accurately based on it.
If the context does not contain the answer, answer based on your general knowledge but politely remind the user that this info was not found in their vault.
Refer to specific document titles or tags if you know them.

Context from user's vault:
${contextText || "No matching documents found in user's vault."}

Available Documents:
${documentsPromptContext || "No documents available in context."}

User Question: "${queryText}"

Instructions:
1. Generate a clear, concise, conversational text reply.
2. Check if the user is explicitly asking to retrieve, view, download, or get the file/document itself (e.g. "give me the invoice", "download my passport", "show me the PDF file", "send me the file").
   - If they are, set "shouldAttachDocumentId" to the matching Document ID.
   - If they are only asking questions about the document content but not asking for the file itself, or if they are asking a general question, set "shouldAttachDocumentId" to null.`;

    const { output: chatResult } = await generateText({
      model: openai("gpt-4o-mini"),
      output: Output.object({
        schema: z.object({
          textReply: z.string().describe("Conversational reply to user's question."),
          shouldAttachDocumentId: z.string().nullable().describe("ID of document user is asking to download or get, otherwise null."),
        }),
      }),
      system: "You are Magic Vault, a helpful document assistant.",
      prompt: systemPrompt,
    });

    const replyText = chatResult.textReply;
    const replies: any[] = [];

    // If user asked for the document, generate a signed download link and attach it
    if (chatResult.shouldAttachDocumentId) {
      const docToAttach = matchedDocs.find((d) => d.id === chatResult.shouldAttachDocumentId);
      if (docToAttach) {
        try {
          const downloadUrl = await ctx.runAction(api.r2.getDownloadUrl, {
            r2Key: docToAttach.r2Key,
            filename: docToAttach.filename,
          });
          replies.push({
            type: "document",
            filename: docToAttach.filename,
            mimeType: docToAttach.mimeType,
            caption: "",
            downloadUrl,
          });
        } catch (err) {
          console.error("Failed to generate download link for simulation reply", err);
        }
      }
    }

    // Only send the text reply if we didn't attach a document
    if (replies.length === 0) {
      replies.push({ type: "text", text: replyText });
    }



    return {
      inbound: {
        kind: args.kind,
        transcript,
      },
      replies,
    };
  },
});

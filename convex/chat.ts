"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { createGateway } from "@ai-sdk/gateway";
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
    // Optional AI provider selection: 'openai' (default) or 'gateway'
    aiProvider: v.optional(v.union(v.literal("openai"), v.literal("gateway"))),
  },
  handler: async (ctx, args): Promise<any> => {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error("Missing OPENAI_API_KEY environment variable.");
    }

    const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
    if (!gatewayApiKey) {
      throw new Error("Missing AI_GATEWAY_API_KEY environment variable.");
    }

    const openai = createOpenAI({ apiKey: openaiApiKey });
    const aiGateway = createGateway({ apiKey: gatewayApiKey });

    // Select model based on user's preference (default: OpenAI gpt-4o-mini)
    const useGateway = args.aiProvider === "gateway";
    const chatModel = useGateway
      ? aiGateway("deepseek/deepseek-v4-flash")
      : openai("gpt-4o-mini");

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
      // Run the ingestion task synchronously
      const ingestResult = await ctx.runAction(internal.ingest.processDocument, {
        documentId: docId,
        userId: user._id,
        r2Key: uploadResult.r2Key,
        mimeType: args.file.mimeType,
        filename,
      });

      const downloadUrl: string = await ctx.runAction(api.r2.getDownloadUrl, {
        r2Key: uploadResult.r2Key,
        filename: (ingestResult.success && ingestResult.filename ? ingestResult.filename : filename),
      });

      const replyText = ingestResult.success
        ? JSON.stringify({
          type: "document_analysis",
          filename: ingestResult.filename,
          category: ingestResult.category,
          summary: ingestResult.summary,
        })
        : `⚠️ Document Ingestion Failed\n\nI was unable to process the uploaded file "${filename}".\n*Reason:* ${ingestResult.error}`;

      return {
        inbound: { kind: "upload", downloadUrl },
        replies: [
          {
            type: "text",
            text: replyText,
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

    // 4. Vector Search (RAG) & Document Catalog & Chat History
    let contextText = "";
    let matchedDocs: Array<{ id: string; filename: string; mimeType: string; summary: string; r2Key: string }> = [];
    let allDocs: any[] = [];
    let recentHistory = "";

    // 4.1 Fetch user's entire document catalog
    try {
      allDocs = await ctx.runQuery(internal.chat_db.listDocumentsInternal, { userId: user._id });
    } catch (err) {
      console.error("Failed to load user documents catalog", err);
    }

    // 4.2 Fetch chat history for conversational context
    try {
      const history = await ctx.runQuery(api.messages.listMessages, { whatsappNumber: args.whatsappNumber });
      // Filter out the active user message we are currently processing if it exists at the end of history
      let previousMessages = history;
      if (previousMessages.length > 0) {
        const lastMsg = previousMessages[previousMessages.length - 1];
        if (lastMsg.sender === "user") {
          previousMessages = previousMessages.slice(0, -1);
        }
      }
      previousMessages = previousMessages.slice(-10);

      recentHistory = previousMessages
        .map((m) => {
          let text = m.text || `[${m.kind} message: ${m.filename || ""}]`;
          // Sanitize JSON payloads from structured responses so the LLM can read them
          if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
            try {
              const parsed = JSON.parse(text);
              if (parsed.type === 'structured_details') {
                const fields = (parsed.fields || []).map((f: any) => `${f.key}: ${f.value}`).join(', ');
                text = `[Shared document details - ${parsed.title || 'Document'}: ${fields}]`;
              } else if (parsed.type === 'document_analysis') {
                text = `[Document saved as "${parsed.filename}" in category "${parsed.category}"]`;
              }
            } catch { /* leave as-is */ }
          }
          return `${m.sender === "user" ? "User" : "Assistant"}: ${text}`;
        })
        .join("\n");
    } catch (err) {
      console.error("Failed to load chat history", err);
    }

    // 4.3 Vector search for matches
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
    const matchedDocumentsPromptContext = matchedDocs
      .map((d) => `- Document ID: "${d.id}", Filename: "${d.filename}"`)
      .join("\n");

    const allDocumentsContext = allDocs
      .map((d) => `- Document ID: "${d._id}", Filename: "${d.filename}", Category: "${d.category}", Summary: "${d.summary}"`)
      .join("\n");

    const systemPrompt = `You are Magic Vault, a highly advanced personal document assistant.
You help users retrieve and remember information from the documents they uploaded.
When answering, you MUST use the provided context from the user's vault documents if it is relevant.
If the context contains the answer, answer concisely and accurately based on it.
If the context does not contain the answer, answer based on your general knowledge but politely remind the user that this info was not found in their vault.
Refer to specific document titles or tags if you know them.

Conversational Memory (Recent History):
${recentHistory || "No previous conversation history."}

All Documents in User's Vault:
${allDocumentsContext || "No documents available in user's vault."}

Context from matched document chunks:
${contextText || "No matching content context found."}

Matched Search Documents:
${matchedDocumentsPromptContext || "No matching search documents."}

User Question: "${queryText}"

Instructions:
1. Generate a clear, concise, conversational text reply. Be friendly and helpful.
2. Check if the user is explicitly asking to retrieve, view, download, or get the file/document itself (e.g. "give me the invoice", "download my passport", "show me the PDF file", "send me the file").
   - If they are, and you can identify the exact matching Document ID from the vault documents, set "shouldAttachDocumentId" to that Document ID.
   - If they are only asking for information, text details, numbers, or facts extracted FROM a document (e.g., "what is my passport number?", "tell me my date of birth from my Aadhaar card", "what details do you have in my PAN card?"), do NOT attach the document file (set "shouldAttachDocumentId" to null). Only answer their question using the context.
   - Set "shouldAttachDocumentId" to the Document ID ONLY when they explicitly want to view, download, or receive the file attachment itself.
   - Otherwise, set "shouldAttachDocumentId" to null.
3. If the user asks for a document type (e.g. "Aadhaar card", "PAN card") but there are multiple documents of that type matching different individuals' names (e.g. "abhijit-pradhan-adhar" and "john-doe-adhar"), and the user hasn't specified whose document they want:
   - Do NOT attach any document yet (set "shouldAttachDocumentId" to null).
   - In your textReply, politely list the names/filenames of the available matching documents and ask the user to clarify whose document they are looking for.
4. Keep the conversation context-aware. If the user clarifies their choice from the previous message (e.g., they said "Abhijit's" in response to your list of options), refer to the history to identify the correct document, and attach it.
5. IMPORTANT - Affirmative confirmation pattern: If the user sends a short affirmative reply ("yes", "ok", "sure", "yeah", "yep", "please", "go ahead") AND the previous assistant message (from Conversational Memory) offered to show, send, or share a document, treat this as an explicit request to retrieve and attach that specific document. Set "shouldAttachDocumentId" to the Document ID of the document that was offered in the last assistant turn. Look at the Conversational Memory to identify which document was last mentioned by the assistant.`;


    const { output: chatResult } = await generateText({
      model: chatModel,
      output: Output.object({
        schema: z.object({
          textReply: z.string().describe("Conversational fallback text reply (if user asks a general question, or for error/clarification messages)."),
          shouldAttachDocumentId: z.string().nullable().describe("ID of document user is asking to download or get, otherwise null."),
          structuredDetails: z.object({
            title: z.string().describe("A title for the details, e.g. 'PAN Card Details'"),
            intro: z.string().describe("Introductory text, e.g. 'Here is the data found in your PAN card:'"),
            fields: z.array(z.object({
              key: z.string().describe("Name of the field, e.g. 'PAN Number', 'Name'"),
              value: z.string().describe("Value of the field"),
            })).describe("List of fields extracted from the document"),
            outro: z.string().describe("Concluding text, e.g. 'If you need anything else, just let me know!'"),
          }).nullable().describe("Use this only if the user is asking for specific information, details, or a summary of fields inside a document. Otherwise set to null."),
        }),
      }),
      system: "You are Magic Vault, a helpful document assistant.",
      prompt: systemPrompt,
    });

    const replyText = chatResult.structuredDetails
      ? JSON.stringify({ type: "structured_details", ...chatResult.structuredDetails })
      : chatResult.textReply;
    const replies: any[] = [];

    // If user asked for the document, generate a signed download link and attach it
    if (chatResult.shouldAttachDocumentId) {
      const docToAttach = matchedDocs.find((d) => d.id === chatResult.shouldAttachDocumentId) ||
        allDocs.find((d) => d._id === chatResult.shouldAttachDocumentId);
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

    // Always include the text reply if it has content
    if (replyText && replyText.trim()) {
      replies.unshift({ type: "text", text: replyText });
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

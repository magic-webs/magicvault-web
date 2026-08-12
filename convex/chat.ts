"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { createGateway } from "@ai-sdk/gateway";
import { generateText, embed, tool, isStepCount } from "ai";
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

    // Default to OpenAI — only use gateway when explicitly requested
    const useGateway = args.aiProvider === "gateway";

    const openai = createOpenAI({ apiKey: openaiApiKey });

    let chatModel: any;
    if (useGateway) {
      const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
      if (!gatewayApiKey) {
        throw new Error("Missing AI_GATEWAY_API_KEY environment variable.");
      }
      const aiGateway = createGateway({ apiKey: gatewayApiKey });
      chatModel = aiGateway("deepseek/deepseek-v4-flash");
    } else {
      // OpenAI is the default
      chatModel = openai("gpt-4o-mini");
    }

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

    // 4. Build context: documents catalog, recent chat history, and vector search
    let contextText = "";
    let matchedDocs: Array<{ id: string; filename: string; mimeType: string; summary: string; r2Key: string }> = [];
    let allDocs: any[] = [];

    // 4.1 Fetch user's entire document catalog
    try {
      allDocs = await ctx.runQuery(internal.chat_db.listDocumentsInternal, { userId: user._id });
    } catch (err) {
      console.error("Failed to load user documents catalog", err);
    }

    // 4.2 Fetch recent chat history as a proper message array for multi-turn context
    type HistoryMessage = { role: "user" | "assistant"; content: string };
    const historyMessages: HistoryMessage[] = [];
    try {
      const recentMsgs = await ctx.runQuery(internal.chat_db.getRecentMessages, {
        userId: user._id,
        limit: 20, // last 20 messages = up to 10 back-and-forth turns
      });

      // Exclude the very last user message if it matches the current query text
      // to avoid the LLM seeing the same message twice in context
      const msgsToInclude = recentMsgs.filter((m) => {
        if (m.sender === "user" && m.text === queryText) return false;
        return true;
      });

      for (const m of msgsToInclude) {
        const role: "user" | "assistant" = m.sender === "user" ? "user" : "assistant";
        let content = m.text || `[${m.kind} message${m.filename ? `: ${m.filename}` : ""}]`;

        // Humanize structured JSON payloads stored in the DB so the LLM reads them naturally
        if (content.trim().startsWith("{") && content.trim().endsWith("}")) {
          try {
            const parsed = JSON.parse(content);
            if (parsed.type === "structured_details") {
              const fields = (parsed.fields || []).map((f: any) => `${f.key}: ${f.value}`).join(", ");
              content = `[Shared document details — ${parsed.title || "Document"}: ${fields}]`;
            } else if (parsed.type === "document_analysis") {
              content = `[Document saved: "${parsed.filename}" in category "${parsed.category}". Summary: ${parsed.summary}]`;
            }
          } catch { /* leave as-is */ }
        }

        historyMessages.push({ role, content });
      }
    } catch (err) {
      console.error("Failed to load chat history", err);
    }

    // 4.3 Vector search for semantically relevant document chunks
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

        // Collect unique matched documents
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

    // 5. Build system prompt context strings
    const allDocumentsContext = allDocs
      .map((d) => `- Document ID: "${d._id}", Filename: "${d.filename}", Category: "${d.category}", Summary: "${d.summary}"`)
      .join("\n");

    const matchedDocumentsContext = matchedDocs
      .map((d) => `- Document ID: "${d.id}", Filename: "${d.filename}"`)
      .join("\n");

    const systemPrompt = `You are Magic Vault, a highly advanced personal document assistant.
You help users retrieve and remember information from the documents they uploaded.

RULES:
- When answering, use the provided context from the user's vault documents if relevant.
- If context contains the answer, be concise and accurate.
- If not found in the vault, answer from general knowledge but note the info wasn't in their vault.
- Refer to specific document titles when you know them.
- For affirmative replies ("yes", "ok", "sure", "yeah", "please", "go ahead"): check the conversation history — if the previous assistant message offered to share/send a document, call attachDocument with that document's ID.
- If the user asks for a document type but multiple matches exist for different people, ask for clarification instead of guessing.

All Documents in User's Vault:
${allDocumentsContext || "No documents available in user's vault."}

Context from semantically matched document chunks:
${contextText || "No matching content found."}

Matched Documents (most relevant to the query):
${matchedDocumentsContext || "None."}`;

    // 6. Define AI SDK v7 tools for each distinct action
    // Note: AI SDK v7 uses `inputSchema` (not `parameters`) for tool definitions

    // Tool: return structured key-value document details to the user
    const getDocumentDetailsTool = tool({
      description: "Use this tool when the user asks for specific information, fields, or details extracted FROM a document (e.g. 'what is my passport number?', 'tell me my PAN card details'). Returns a structured card with labeled fields.",
      inputSchema: z.object({
        title: z.string().describe("Card title, e.g. 'PAN Card Details'"),
        intro: z.string().describe("Introductory sentence, e.g. 'Here is the info from your PAN card:'"),
        fields: z.array(z.object({
          key: z.string().describe("Field label, e.g. 'PAN Number'"),
          value: z.string().describe("Field value"),
        })).describe("List of extracted fields"),
        outro: z.string().describe("Closing sentence, e.g. 'Let me know if you need anything else!'"),
      }),
      execute: async (input: {
        title: string;
        intro: string;
        fields: Array<{ key: string; value: string }>;
        outro: string;
      }) => input,
    });

    // Tool: attach/send a document file to the user
    const attachDocumentTool = tool({
      description: "Use this tool ONLY when the user explicitly wants to receive, download, view, or get the actual file/document (e.g. 'give me my invoice', 'download my passport', 'send me the PDF'). Do NOT use this for information-only questions. Set documentId to the exact Document ID from the vault.",
      inputSchema: z.object({
        documentId: z.string().describe("The exact Document ID from the vault to attach"),
        textReply: z.string().describe("A short message to send alongside the document, e.g. 'Here is your passport!'"),
      }),
      execute: async (input: { documentId: string; textReply: string }) => input,
    });

    // 7. Build message list for the LLM: history + current query
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...historyMessages,
      { role: "user", content: queryText },
    ];

    // 8. Call the LLM with tools (AI SDK v7)
    // stopWhen replaces maxSteps — allow up to 3 steps (tool call + final text)
    const result = await generateText({
      model: chatModel,
      system: systemPrompt,
      messages,
      tools: {
        getDocumentDetails: getDocumentDetailsTool,
        attachDocument: attachDocumentTool,
      },
      toolChoice: "auto",
      stopWhen: isStepCount(3),
    });

    // 9. Process tool call results into reply messages
    const replies: any[] = [];

    // Collect tool calls from all steps
    for (const step of result.steps) {
      for (const toolCall of (step.toolCalls ?? [])) {
        if (toolCall.toolName === "getDocumentDetails") {
          const details = (toolCall as any).input as {
            title: string;
            intro: string;
            fields: Array<{ key: string; value: string }>;
            outro: string;
          };
          // Emit as structured_details JSON (matches existing frontend renderer)
          replies.push({
            type: "text",
            text: JSON.stringify({ type: "structured_details", ...details }),
          });
        } else if (toolCall.toolName === "attachDocument") {
          const { documentId, textReply: attachText } = (toolCall as any).input as {
            documentId: string;
            textReply: string;
          };

          // Find the document in matched or all docs
          const docToAttach =
            matchedDocs.find((d) => d.id === documentId) ||
            allDocs.find((d) => d._id === documentId);

          if (docToAttach) {
            try {
              const downloadUrl = await ctx.runAction(api.r2.getDownloadUrl, {
                r2Key: docToAttach.r2Key,
                filename: docToAttach.filename,
              });

              // Add text message before the document card
              if (attachText?.trim()) {
                replies.push({ type: "text", text: attachText });
              }

              replies.push({
                type: "document",
                filename: docToAttach.filename,
                mimeType: docToAttach.mimeType,
                caption: "",
                downloadUrl,
              });
            } catch (err) {
              console.error("Failed to generate download link", err);
              replies.push({
                type: "text",
                text: `I found the document "${docToAttach.filename}" but couldn't generate a download link. Please try again.`,
              });
            }
          } else {
            replies.push({
              type: "text",
              text: `I couldn't find a document with ID "${documentId}" in your vault. Please check your documents.`,
            });
          }
        }
      }
    }

    // 10. Include the model's plain text response (free text between/after tool calls)
    const textReply = result.text?.trim();

    // Add text reply only if:
    // - there is actual text content AND
    // - no getDocumentDetails tool was called (since that already covers the text response)
    const hasStructuredToolReply = replies.some(
      (r) => r.type === "text" && typeof r.text === "string" && r.text.startsWith('{"type":"structured_details"')
    );
    if (textReply && !hasStructuredToolReply) {
      replies.unshift({ type: "text", text: textReply });
    }

    // Fallback: if no reply was produced at all, give a generic response
    if (replies.length === 0) {
      replies.push({ type: "text", text: "I'm not sure how to help with that. Could you rephrase your question?" });
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

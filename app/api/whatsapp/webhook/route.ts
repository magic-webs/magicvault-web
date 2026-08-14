import { NextRequest, NextResponse, after } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { sendWhatsAppText, sendWhatsAppDocument, downloadWhatsAppMedia } from "@/lib/whatsapp-api";

// Helper: retry Convex operations if serverless socket resets occur
async function retryConvex<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 200 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

// --- GET: WhatsApp webhook verification --------------------------------------
// Echo back the 'challange' query parameter
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const challenge = searchParams.get("challange") || searchParams.get("hub.challenge");
    
    if (challenge) {
      return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    } else {
      return new NextResponse("no challange", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
  } catch (error: any) {
    return new NextResponse(error.message, { status: 500 });
  }
}

// --- POST: Receive incoming WhatsApp messages ---------------------------------
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const origin = request.nextUrl.origin;

  // Next.js 16 after():
  // Meta gets HTTP 200 in ~10ms so Meta webhooks never time out,
  // while Vercel keeps the function instance active until processIncoming completes!
  after(async () => {
    try {
      await processIncoming(body, origin);
    } catch (err) {
      console.error("[WhatsApp Webhook] Background processing error:", err);
    }
  });

  return NextResponse.json({ status: "ok" }, { status: 200 });
}

// --- Core logic: parse -> simulate -> reply ------------------------------------
async function processIncoming(body: any, origin: string) {
  try {
    // Validate it's a WhatsApp message event
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value || !value.messages || value.messages.length === 0) {
      // Status update or non-message event - ignore
      return;
    }

    const incomingMsg = value.messages[0];
    const fromNumber: string = incomingMsg.from; // e.g. "918926029883"
    const messageType: string = incomingMsg.type; // "text", "audio", "document", "image", etc.

    console.log(
      `[WhatsApp Webhook] Incoming ${messageType} message from ${fromNumber}`
    );

    let simulateResult: any = null;

    if (messageType === "text") {
      const messageText: string = incomingMsg.text?.body || "";
      if (!messageText.trim()) return;

      // Save user message
      let userMessageId: any = null;
      try {
        userMessageId = await retryConvex(() =>
          convexClient.mutation(api.messages.storeMessage, {
            whatsappNumber: fromNumber,
            sender: "user",
            kind: "text",
            text: messageText,
            status: "sending",
          })
        );
      } catch (err) {
        console.error("[WhatsApp Webhook] Failed to store user message:", err);
      }

      // Simulate text chat
      try {
        simulateResult = await retryConvex(() =>
          convexClient.action(api.chat.simulate, {
            kind: "text",
            whatsappNumber: fromNumber,
            text: messageText,
          })
        );
      } catch (simErr: any) {
        console.error("[WhatsApp Webhook] AI simulation error:", simErr);
        await sendWhatsAppText(fromNumber, "Sorry, I encountered an error while processing your request. Please try again.");
        return;
      }

      if (userMessageId) {
        try {
          await retryConvex(() =>
            convexClient.mutation(api.messages.updateMessageStatus, {
              messageId: userMessageId,
              status: "sent",
            })
          );
        } catch (err) {
          console.error("[WhatsApp Webhook] Failed to update user message status:", err);
        }
      }
    } else if (messageType === "audio" || messageType === "voice") {
      const mediaId = incomingMsg.audio?.id || incomingMsg.voice?.id;
      if (!mediaId) return;

      try {
        const { base64, mimeType } = await downloadWhatsAppMedia(mediaId);

        await retryConvex(() =>
          convexClient.mutation(api.messages.storeMessage, {
            whatsappNumber: fromNumber,
            sender: "user",
            kind: "voice",
            text: "🎤 Voice Message",
            status: "sent",
          })
        );

        simulateResult = await retryConvex(() =>
          convexClient.action(api.chat.simulate, {
            kind: "voice",
            whatsappNumber: fromNumber,
            audio: { base64, mimeType },
          })
        );
      } catch (err: any) {
        console.error("[WhatsApp Webhook] Audio processing error:", err);
        await sendWhatsAppText(fromNumber, "⚠️ Sorry, I was unable to process your voice note. Please try sending a text message or uploading a document.");
        return;
      }
    } else if (messageType === "document" || messageType === "image") {
      const mediaObj = incomingMsg.document || incomingMsg.image;
      const mediaId = mediaObj?.id;
      const filename = mediaObj?.filename || (messageType === "image" ? "whatsapp_photo.jpg" : "whatsapp_document.pdf");
      if (!mediaId) return;

      try {
        const { base64, mimeType } = await downloadWhatsAppMedia(mediaId);

        await retryConvex(() =>
          convexClient.mutation(api.messages.storeMessage, {
            whatsappNumber: fromNumber,
            sender: "user",
            kind: "document",
            filename,
            mimeType,
            text: `📄 Uploaded: ${filename}`,
            status: "sent",
          })
        );

        simulateResult = await retryConvex(() =>
          convexClient.action(api.chat.simulate, {
            kind: "upload",
            whatsappNumber: fromNumber,
            file: { base64, mimeType, filename },
          })
        );
      } catch (err: any) {
        console.error("[WhatsApp Webhook] Document processing error:", err);
        await sendWhatsAppText(
          fromNumber,
          `⚠️ Sorry, I was unable to process "${filename}". Please try uploading a PDF, document, or image file!`
        );
        return;
      }
    } else {
      await sendWhatsAppText(
        fromNumber,
        "I can process text questions, voice notes, and document/PDF uploads! Please send a text, voice note, or document file."
      );
      return;
    }

    // -- Step 3: Store assistant replies & send via WhatsApp API --------------
    const replies: any[] = simulateResult?.replies ?? [];

    if (replies.length === 0) {
      await sendWhatsAppText(
        fromNumber,
        "Thank you for your message! No specific actions were generated for this prompt."
      );
      return;
    }

    for (let i = 0; i < replies.length; i++) {
      const reply = replies[i];

      // Store in database
      try {
        if (reply.type === "text") {
          await retryConvex(() =>
            convexClient.mutation(api.messages.storeMessage, {
              whatsappNumber: fromNumber,
              sender: "assistant",
              kind: "text",
              text: reply.text,
            })
          );
        } else if (reply.type === "document") {
          await retryConvex(() =>
            convexClient.mutation(api.messages.storeMessage, {
              whatsappNumber: fromNumber,
              sender: "assistant",
              kind: "document",
              filename: reply.filename,
              mimeType: reply.mimeType,
              text: reply.caption,
              downloadUrl: reply.downloadUrl,
            })
          );
        }
      } catch (err) {
        console.error("[WhatsApp Webhook] Failed to store assistant reply:", err);
      }

      // Send back via WhatsApp API
      try {
        if (reply.type === "text") {
          let textToSend = reply.text || "";

          // If it's a structured_details JSON or document_analysis JSON, convert to readable text
          if (textToSend.trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(textToSend);
              if (parsed.type === "document_analysis") {
                textToSend = `📄 *Document Analyzed & Saved!*\n\n- *Filename*: ${parsed.filename || "Uploaded File"}\n- *Category*: ${parsed.category || "General"}\n- *Summary*: ${parsed.summary || ""}`;
              } else if (parsed.type === "structured_details") {
                const fieldLines = (parsed.fields || [])
                  .map((f: { key: string; value: string }) => `- *${f.key}*: ${f.value}`)
                  .join("\n");
                textToSend = `*${parsed.title || "Details"}*\n\n${parsed.intro || ""}\n\n${fieldLines}\n\n${parsed.outro || ""}`;
              }
            } catch {
              // leave as-is if parsing fails
            }
          }

          await sendWhatsAppText(fromNumber, textToSend);
        } else if (reply.type === "document" && reply.downloadUrl) {
          await sendWhatsAppDocument(
            fromNumber,
            reply.downloadUrl,
            reply.filename || "Document",
            reply.caption || undefined
          );
        }
      } catch (err) {
        console.error("[WhatsApp Webhook] Failed to send reply via WhatsApp API:", err);
      }
    }

    console.log(
      `[WhatsApp Webhook] Processed message from ${fromNumber}, sent ${replies.length} reply(ies).`
    );
  } catch (err) {
    console.error("[WhatsApp Webhook] processIncoming error:", err);
  }
}
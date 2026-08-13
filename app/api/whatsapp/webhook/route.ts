import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { sendWhatsAppText, sendWhatsAppDocument } from "@/lib/whatsapp-api";

const WEBHOOK_VERIFY_TOKEN =
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "magicvault_webhook_token";

// --- GET: WhatsApp webhook verification --------------------------------------
// Meta sends a GET request with hub.mode, hub.verify_token, hub.challenge.
// We must echo back hub.challenge if the token matches.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("[WhatsApp Webhook] Verified successfully.");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("[WhatsApp Webhook] Verification failed. Token mismatch.");
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

// --- POST: Receive incoming WhatsApp messages ---------------------------------
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Acknowledge immediately — Meta expects 200 within 5 seconds
  // We process in the background after responding
  processIncoming(body).catch((err) =>
    console.error("[WhatsApp Webhook] Background processing error:", err)
  );

  return NextResponse.json({ status: "ok" }, { status: 200 });
}

// --- Core logic: parse ? simulate ? reply ------------------------------------
async function processIncoming(body: any) {
  try {
    // Validate it's a WhatsApp message event
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value || !value.messages || value.messages.length === 0) {
      // Status update or non-message event — ignore
      return;
    }

    const incomingMsg = value.messages[0];
    const fromNumber: string = incomingMsg.from; // e.g. "15553320705"
    const messageType: string = incomingMsg.type; // "text", "audio", "document", etc.

    console.log(
      `[WhatsApp Webhook] Incoming ${messageType} message from ${fromNumber}`
    );

    // Only handle text messages in this integration (voice/docs require extra steps)
    if (messageType !== "text") {
      await sendWhatsAppText(
        fromNumber,
        "I can currently only process text messages via WhatsApp. Please type your question!"
      );
      return;
    }

    const messageText: string = incomingMsg.text?.body || "";
    if (!messageText.trim()) {
      return;
    }

    // -- Step 1: Save user message & run AI via existing simulate route logic --
    // We call convex directly, same as the internal /api/simulate/message route does
    let userMessageId: any = null;

    try {
      userMessageId = await convexClient.mutation(api.messages.storeMessage, {
        whatsappNumber: fromNumber,
        sender: "user",
        kind: "text",
        text: messageText,
        status: "sending",
      });
    } catch (err) {
      console.error("[WhatsApp Webhook] Failed to store user message:", err);
    }

    // -- Step 2: Run the AI chat simulation -----------------------------------
    const simulateResult = await convexClient.action(api.chat.simulate, {
      kind: "text",
      whatsappNumber: fromNumber,
      text: messageText,
    });

    // Mark user message as sent
    if (userMessageId) {
      try {
        await convexClient.mutation(api.messages.updateMessageStatus, {
          messageId: userMessageId,
          status: "sent",
        });
      } catch (err) {
        console.error("[WhatsApp Webhook] Failed to update user message status:", err);
      }
    }

    // -- Step 3: Store assistant replies & send via WhatsApp API --------------
    const replies: any[] = simulateResult?.replies ?? [];

    for (const reply of replies) {
      // Store in database
      try {
        if (reply.type === "text") {
          await convexClient.mutation(api.messages.storeMessage, {
            whatsappNumber: fromNumber,
            sender: "assistant",
            kind: "text",
            text: reply.text,
          });
        } else if (reply.type === "document") {
          await convexClient.mutation(api.messages.storeMessage, {
            whatsappNumber: fromNumber,
            sender: "assistant",
            kind: "document",
            filename: reply.filename,
            mimeType: reply.mimeType,
            text: reply.caption,
            downloadUrl: reply.downloadUrl,
          });
        }
      } catch (err) {
        console.error("[WhatsApp Webhook] Failed to store assistant reply:", err);
      }

      // Send back via WhatsApp API
      try {
        if (reply.type === "text") {
          // Format structured JSON replies as plain text for WhatsApp
          let textToSend = reply.text || "";

          // If it's a structured_details JSON, convert to readable text
          if (textToSend.trim().startsWith('{"type":"structured_details"')) {
            try {
              const parsed = JSON.parse(textToSend);
              const fieldLines = (parsed.fields || [])
                .map((f: { key: string; value: string }) => `• *${f.key}*: ${f.value}`)
                .join("\n");
              textToSend = `*${parsed.title || "Details"}*\n\n${parsed.intro || ""}\n\n${fieldLines}\n\n${parsed.outro || ""}`;
            } catch {
              // leave as-is if parsing fails
            }
          }

          await sendWhatsAppText(fromNumber, textToSend);
        } else if (reply.type === "document" && reply.downloadUrl) {
          // First send a text caption if present
          // Then send the document
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

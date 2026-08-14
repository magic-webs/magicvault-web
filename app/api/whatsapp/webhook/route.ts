import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { sendWhatsAppText, sendWhatsAppDocument } from "@/lib/whatsapp-api";

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

  // Acknowledge immediately - Meta expects 200 within 5 seconds
  // We process in the background after responding
  processIncoming(body).catch((err) =>
    console.error("[WhatsApp Webhook] Background processing error:", err)
  );

  return NextResponse.json({ status: "ok" }, { status: 200 });
}

// --- Core logic: parse -> simulate -> reply ------------------------------------
async function processIncoming(body: any) {
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
    const fromNumber: string = incomingMsg.from; // e.g. "15553320705"
    const messageType: string = incomingMsg.type; // "text", "audio", "document", etc.

    console.log(
      `[WhatsApp Webhook] Incoming ${messageType} message from ${fromNumber}`
    );

    // Only handle text messages in this integration
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

    // -- Step 1: Save user message --
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

    // -- Step 2: Run the AI chat simulation --
    let simulateResult: any = null;
    try {
      simulateResult = await convexClient.action(api.chat.simulate, {
        kind: "text",
        whatsappNumber: fromNumber,
        text: messageText,
      });
    } catch (simErr: any) {
      console.error("[WhatsApp Webhook] AI simulation error:", simErr);
      await sendWhatsAppText(
        fromNumber,
        "Sorry, I encountered an error while processing your request. Please try again."
      );
      return;
    }

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

    if (replies.length === 0) {
      await sendWhatsAppText(
        fromNumber,
        "Thank you for your message! No specific actions were generated for this prompt."
      );
      return;
    }

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
          let textToSend = reply.text || "";

          // If it's a structured_details JSON, convert to readable text
          if (textToSend.trim().startsWith('{"type":"structured_details"')) {
            try {
              const parsed = JSON.parse(textToSend);
              const fieldLines = (parsed.fields || [])
                .map((f: { key: string; value: string }) => `- *${f.key}*: ${f.value}`)
                .join("\n");
              textToSend = `*${parsed.title || "Details"}*\n\n${parsed.intro || ""}\n\n${fieldLines}\n\n${parsed.outro || ""}`;
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
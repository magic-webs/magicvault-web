import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { sendWhatsAppText, sendWhatsAppDocument } from "@/lib/whatsapp-api";

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

  // Await processIncoming so Vercel Serverless environment does NOT freeze/kill execution!
  try {
    await processIncoming(body, origin);
  } catch (err) {
    console.error("[WhatsApp Webhook] Processing error:", err);
  }

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
    const fromNumber: string = incomingMsg.from; // e.g. "15553320705"
    const messageType: string = incomingMsg.type; // "text", "audio", "document", etc.

    console.log(
      `[WhatsApp Webhook] Incoming ${messageType} message from ${fromNumber}`
    );

    // Check if user is registered on Web
    let isUserRegistered = false;
    try {
      const userInfo = await retryConvex(() =>
        convexClient.query(api.users.getUserByWhatsApp, {
          whatsappNumber: fromNumber,
        })
      );
      if (userInfo && userInfo.isRegistered) {
        isUserRegistered = true;
      }
    } catch (err) {
      console.error("[WhatsApp Webhook] Error checking user registration:", err);
    }

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

    // -- Step 1: Save user message (auto-creates user record if not present) --
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

    // -- Step 2: Run the AI chat simulation --
    let simulateResult: any = null;
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
      await sendWhatsAppText(
        fromNumber,
        "Sorry, I encountered an error while processing your request. Please try again."
      );
      return;
    }

    // Mark user message as sent
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

    // -- Step 3: Store assistant replies & send via WhatsApp API --------------
    const replies: any[] = simulateResult?.replies ?? [];

    if (replies.length === 0) {
      await sendWhatsAppText(
        fromNumber,
        "Thank you for your message! No specific actions were generated for this prompt."
      );
      return;
    }

    // If user is not registered on the web app, prepare registration prompt
    const registerUrl = `${origin}/register`;
    const registerPrompt = `\n\n👉 *Web Vault:* Complete your account registration here to access your dashboard and documents:\n${registerUrl}`;

    for (let i = 0; i < replies.length; i++) {
      const reply = replies[i];
      const isLastReply = i === replies.length - 1;

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

          // Attach register link to text if user is unregistered and it's the last reply
          if (!isUserRegistered && isLastReply) {
            textToSend += registerPrompt;
          }

          await sendWhatsAppText(fromNumber, textToSend);
        } else if (reply.type === "document" && reply.downloadUrl) {
          await sendWhatsAppDocument(
            fromNumber,
            reply.downloadUrl,
            reply.filename || "Document",
            reply.caption || undefined
          );

          // If unregistered and document is last reply, send register link as follow-up text
          if (!isUserRegistered && isLastReply) {
            await sendWhatsAppText(fromNumber, registerPrompt.trim());
          }
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
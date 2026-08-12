import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";

export async function POST(request: NextRequest) {
  let userMessageId: any = null;
  let body: any = null;
  try {
    body = await request.json();
    
    // Determine details for saving user's message
    const kind: "text" | "voice" | "upload" = body.kind;
    const text: string | undefined = body.text;
    let filename: string | undefined = undefined;
    let mimeType: string | undefined = undefined;
    
    if (kind === "upload" && body.file) {
      filename = body.file.filename;
      mimeType = body.file.mimeType;
    } else if (kind === "voice" && body.audio) {
      mimeType = body.audio.mimeType;
    }
    
    // Save user's message as "sending" in the database
    try {
      userMessageId = await convexClient.mutation(api.messages.storeMessage, {
        whatsappNumber: body.whatsappNumber,
        sender: "user",
        kind,
        text,
        filename,
        mimeType,
        status: "sending",
      });
    } catch (err) {
      console.error("Failed to store user message initially", err);
    }
    
    // Dispatch to the Convex simulate action
    const data = await convexClient.action(api.chat.simulate, body);

    // If userMessageId was stored, update its status to "sent"
    if (userMessageId) {
      await convexClient.mutation(api.messages.updateMessageStatus, {
        messageId: userMessageId,
        status: "sent",
        downloadUrl: data.inbound?.downloadUrl,
        previewUrl: data.inbound?.downloadUrl,
      });
      
      // If voice message transcript was generated, save that as an assistant transcript message
      if (kind === "voice" && data.inbound?.transcript) {
        await convexClient.mutation(api.messages.storeMessage, {
          whatsappNumber: body.whatsappNumber,
          sender: "assistant",
          kind: "transcript",
          text: data.inbound.transcript,
        });
      }
    }
    
    // Store assistant's reply messages in the database
    for (const reply of data.replies) {
      const replyKind: "text" | "voice" | "document" = reply.type;
      let replyText: string | undefined = undefined;
      let replyAudioUrl: string | undefined = undefined;
      let replyDurationSec: number | undefined = undefined;
      let replyFilename: string | undefined = undefined;
      let replyMimeType: string | undefined = undefined;
      let replyDownloadUrl: string | undefined = undefined;
      
      if (replyKind === "text") {
        replyText = reply.text;
      } else if (replyKind === "voice") {
        replyAudioUrl = reply.audioUrl;
        replyDurationSec = reply.durationSec;
      } else if (replyKind === "document") {
        replyFilename = reply.filename;
        replyMimeType = reply.mimeType;
        replyText = reply.caption;
        replyDownloadUrl = reply.downloadUrl;
      }
      
      await convexClient.mutation(api.messages.storeMessage, {
        whatsappNumber: body.whatsappNumber,
        sender: "assistant",
        kind: replyKind,
        text: replyText,
        audioUrl: replyAudioUrl,
        durationSec: replyDurationSec,
        filename: replyFilename,
        mimeType: replyMimeType,
        downloadUrl: replyDownloadUrl,
      });
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Simulation route error", error);
    
    // Mark user message as error in the database
    if (userMessageId) {
      try {
        await convexClient.mutation(api.messages.updateMessageStatus, {
          messageId: userMessageId,
          status: "error",
        });
        
        // Save assistant error message
        const errMsg = error instanceof Error ? error.message : "Simulation failed";
        await convexClient.mutation(api.messages.storeMessage, {
          whatsappNumber: body?.whatsappNumber,
          sender: "assistant",
          kind: "error",
          text: errMsg,
        });
      } catch (err) {
        console.error("Failed to mark message as error in database", err);
      }
    }
    
    return NextResponse.json(
      { success: false, error: { message: error instanceof Error ? error.message : "Simulation failed" } },
      { status: 500 }
    );
  }
}

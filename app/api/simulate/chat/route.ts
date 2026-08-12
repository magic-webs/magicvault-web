import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const whatsappNumber = searchParams.get("whatsappNumber");

    if (!whatsappNumber) {
      return NextResponse.json(
        { success: false, error: { message: "whatsappNumber query parameter is required" } },
        { status: 400 }
      );
    }

    const messages = await convexClient.query(api.messages.listMessages, { whatsappNumber });

    return NextResponse.json({
      success: true,
      data: messages,
    });
  } catch (error) {
    console.error("Failed to fetch chat history", error);
    return NextResponse.json(
      { success: false, error: { message: error instanceof Error ? error.message : "Failed to fetch chat history" } },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const whatsappNumber = searchParams.get("whatsappNumber");

    if (!whatsappNumber) {
      return NextResponse.json(
        { success: false, error: { message: "whatsappNumber query parameter is required" } },
        { status: 400 }
      );
    }

    await convexClient.mutation(api.messages.clearMessages, { whatsappNumber });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Failed to clear chat history", error);
    return NextResponse.json(
      { success: false, error: { message: error instanceof Error ? error.message : "Failed to clear chat history" } },
      { status: 500 }
    );
  }
}

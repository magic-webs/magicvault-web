import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: { message: "Unauthorized: Missing token." } },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const { documentId } = await params;

    const doc = await convexClient.query(api.documents.getDocument, {
      documentId,
      token,
    });

    return NextResponse.json({
      success: true,
      data: doc,
    });
  } catch (error) {
    console.error("Get document details error", error);
    return NextResponse.json(
      { success: false, error: { message: error instanceof Error ? error.message : "Failed to load document details" } },
      { status: 404 }
    );
  }
}

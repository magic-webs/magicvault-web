import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";

export async function POST(
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

    // 1. Fetch document (validates token + ownership inside query)
    const doc = await convexClient.query(api.documents.getDocument, {
      documentId,
      token,
    });

    // 2. Generate pre-signed URL using Convex action
    const downloadUrl = await convexClient.action(api.r2.getDownloadUrl, {
      r2Key: doc.r2Key,
      filename: doc.filename,
    });

    return NextResponse.json({
      success: true,
      data: { downloadUrl },
    });
  } catch (error) {
    console.error("Get download link error", error);
    return NextResponse.json(
      { success: false, error: { message: error instanceof Error ? error.message : "Failed to generate download link" } },
      { status: 400 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: { message: "Unauthorized: Missing token." } },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const documentsResult = await convexClient.query(api.documents.listUserDocuments, { token });

    return NextResponse.json({
      success: true,
      data: documentsResult,
    });
  } catch (error) {
    console.error("List documents error", error);
    return NextResponse.json(
      { success: false, error: { message: error instanceof Error ? error.message : "Failed to load documents" } },
      { status: 401 }
    );
  }
}

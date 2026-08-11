import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: { message: "Unauthorized: Missing or malformed token." } },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const user = await convexClient.query(api.users.getUserByToken, { token });

    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: "Unauthorized: Invalid or expired session." } },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    console.error("Auth profile error", error);
    return NextResponse.json(
      { success: false, error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { cleanErrorMessage } from "@/lib/auth-api";

export async function POST(request: NextRequest) {
  try {
    const { whatsappNumber, password, name } = await request.json();

    if (!whatsappNumber || !password) {
      return NextResponse.json(
        { success: false, error: { message: "WhatsApp number and password are required." } },
        { status: 400 }
      );
    }

    const data = await convexClient.mutation(api.users.register, {
      whatsappNumber,
      password,
      name,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Registration error", error);
    const rawMsg = error instanceof Error ? error.message : "Registration failed";
    return NextResponse.json(
      { success: false, error: { message: cleanErrorMessage(rawMsg) } },
      { status: 400 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Dispatch to the Convex simulate action
    const data = await convexClient.action(api.chat.simulate, body);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Simulation route error", error);
    return NextResponse.json(
      { success: false, error: { message: error instanceof Error ? error.message : "Simulation failed" } },
      { status: 500 }
    );
  }
}

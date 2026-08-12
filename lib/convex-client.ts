import { ConvexHttpClient } from "convex/browser";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  console.warn("WARNING: NEXT_PUBLIC_CONVEX_URL is not set. Make sure to run `npx convex dev` first.");
}

export const convexClient = new ConvexHttpClient(convexUrl || "http://localhost:8000");

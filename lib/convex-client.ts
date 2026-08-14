import { ConvexHttpClient } from "convex/browser";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  console.warn("WARNING: NEXT_PUBLIC_CONVEX_URL is not set. Make sure to run `npx convex dev` first.");
}

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, cache: "no-store" });
  } catch (err: any) {
    const code = err?.cause?.code;
    if (code === "ECONNRESET" || code === "UND_ERR_SOCKET" || err?.message?.includes("fetch failed")) {
      console.warn("[Convex Client] Socket reset detected, retrying fetch...", code || err.message);
      return await fetch(input, { ...init, cache: "no-store" });
    }
    throw err;
  }
}

export const convexClient = new ConvexHttpClient(convexUrl || "http://localhost:8000", {
  fetch: resilientFetch,
});
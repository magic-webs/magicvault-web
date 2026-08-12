import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const getRecentMessages = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    // Fetch all messages for the user and take the last `limit` by timestamp
    const allMessages = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Sort ascending by timestamp then take the last `limit`
    const sorted = allMessages.sort((a, b) => a.timestamp - b.timestamp);
    return sorted.slice(-limit);
  },
});

export const getUserByPhone = internalQuery({
  args: {
    whatsappNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_whatsappNumber", (q) => q.eq("whatsappNumber", args.whatsappNumber))
      .unique();
    return user;
  },
});

export const getChunksWithDocs = internalQuery({
  args: {
    chunkIds: v.array(v.id("chunks")),
  },
  handler: async (ctx, args) => {
    const results = [];
    for (const id of args.chunkIds) {
      const chunk = await ctx.db.get(id);
      if (chunk) {
        const doc = await ctx.db.get(chunk.documentId);
        results.push({
          text: chunk.text,
          documentId: chunk.documentId,
          filename: doc?.filename ?? "Unknown File",
          mimeType: doc?.mimeType ?? "application/octet-stream",
          category: doc?.category ?? "Uncategorized",
          summary: doc?.summary ?? "",
          r2Key: doc?.r2Key ?? "",
        });
      }
    }
    return results;
  },
});

export const getUserById = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const listDocumentsInternal = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { hashPassword, DEFAULT_PASSWORD } from "./users";

export const listMessages = query({
  args: {
    whatsappNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_whatsappNumber", (q) => q.eq("whatsappNumber", args.whatsappNumber))
      .unique();
    if (!user) return [];

    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return msgs.map((m) => ({
      id: m._id,
      sender: m.sender,
      kind: m.kind,
      text: m.text,
      audioUrl: m.audioUrl,
      durationSec: m.durationSec,
      filename: m.filename,
      mimeType: m.mimeType,
      downloadUrl: m.downloadUrl,
      previewUrl: m.previewUrl,
      status: m.status,
      timestamp: new Date(m.timestamp).toISOString(),
    }));
  },
});

export const storeMessage = mutation({
  args: {
    whatsappNumber: v.string(),
    sender: v.union(v.literal("user"), v.literal("assistant")),
    kind: v.union(v.literal("text"), v.literal("voice"), v.literal("upload"), v.literal("document"), v.literal("transcript"), v.literal("error")),
    text: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    downloadUrl: v.optional(v.string()),
    previewUrl: v.optional(v.string()),
    status: v.optional(v.union(v.literal("sending"), v.literal("sent"), v.literal("error"))),
  },
  handler: async (ctx, args) => {
    const cleanNumber = args.whatsappNumber.replace(/\D/g, '');
    let user = await ctx.db
      .query("users")
      .withIndex("by_whatsappNumber", (q) => q.eq("whatsappNumber", cleanNumber))
      .unique();

    if (!user) {
      const defaultHash = await hashPassword(DEFAULT_PASSWORD, cleanNumber);
      const userId = await ctx.db.insert("users", {
        whatsappNumber: cleanNumber,
        passwordHash: defaultHash,
        createdAt: Date.now(),
      });
      user = (await ctx.db.get(userId))!;
    }

    const { whatsappNumber, ...msgDetails } = args;
    const messageId = await ctx.db.insert("messages", {
      userId: user._id,
      ...msgDetails,
      timestamp: Date.now(),
    });

    return messageId;
  },
});

export const updateMessageStatus = mutation({
  args: {
    messageId: v.id("messages"),
    status: v.union(v.literal("sending"), v.literal("sent"), v.literal("error")),
    downloadUrl: v.optional(v.string()),
    previewUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { messageId, ...updates } = args;
    await ctx.db.patch(messageId, updates);
  },
});

export const clearMessages = mutation({
  args: {
    whatsappNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_whatsappNumber", (q) => q.eq("whatsappNumber", args.whatsappNumber))
      .unique();
    if (!user) return;

    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    for (const m of msgs) {
      await ctx.db.delete(m._id);
    }
  },
});
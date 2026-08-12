import { v } from "convex/values";
import { query, mutation, internalMutation, action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

// Schema-aligned interface
export interface VaultDocument {
  id: string;
  userId: string;
  whatsappNumber: string;
  title: string;
  filename: string;
  documentType: string;
  category: string;
  summary: string;
  tags: string[];
  mimeType: string;
  size: number;
  r2Key: string;
  status: "processing" | "ready" | "failed";
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export const listUserDocuments = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // Authenticate
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!session || session.expiry < Date.now()) {
      throw new Error("Unauthorized or expired session");
    }

    const user = await ctx.db.get(session.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Map to API response schema
    const items = docs.map((doc) => ({
      id: doc._id,
      userId: doc.userId,
      whatsappNumber: user.whatsappNumber,
      title: doc.title,
      filename: doc.filename,
      documentType: doc.documentType,
      category: doc.category,
      summary: doc.summary,
      tags: doc.tags,
      mimeType: doc.mimeType,
      size: doc.size,
      r2Key: doc.r2Key,
      status: doc.status,
      failureReason: doc.failureReason ?? null,
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc._creationTime).toISOString(),
    }));

    return {
      items,
      total: items.length,
      page: 1,
      pageSize: items.length || 10,
    };
  },
});

export const createDocument = mutation({
  args: {
    token: v.string(),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    r2Key: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!session || session.expiry < Date.now()) {
      throw new Error("Unauthorized");
    }

    const docId = await ctx.db.insert("documents", {
      userId: session.userId,
      title: args.filename,
      filename: args.filename,
      documentType: args.mimeType.split("/")[0] || "document",
      category: "Uncategorized",
      summary: "",
      tags: [],
      mimeType: args.mimeType,
      size: args.size,
      r2Key: args.r2Key,
      status: "processing",
      createdAt: Date.now(),
    });

    return docId;
  },
});

export const createDocumentInternal = internalMutation({
  args: {
    userId: v.id("users"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    r2Key: v.string(),
  },
  handler: async (ctx, args) => {
    const docId = await ctx.db.insert("documents", {
      userId: args.userId,
      title: args.filename,
      filename: args.filename,
      documentType: args.mimeType.split("/")[0] || "document",
      category: "Uncategorized",
      summary: "",
      tags: [],
      mimeType: args.mimeType,
      size: args.size,
      r2Key: args.r2Key,
      status: "processing",
      createdAt: Date.now(),
    });

    return docId;
  },
});


export const updateDocumentDetails = internalMutation({
  args: {
    documentId: v.id("documents"),
    title: v.string(),
    filename: v.optional(v.string()),
    category: v.string(),
    summary: v.string(),
    tags: v.array(v.string()),
    status: v.union(v.literal("ready"), v.literal("failed")),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { documentId, ...details } = args;
    await ctx.db.patch(documentId, details);
  },
});

export const insertChunks = internalMutation({
  args: {
    documentId: v.id("documents"),
    userId: v.id("users"),
    chunks: v.array(
      v.object({
        text: v.string(),
        embedding: v.array(v.float64()),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const chunk of args.chunks) {
      await ctx.db.insert("chunks", {
        documentId: args.documentId,
        userId: args.userId,
        text: chunk.text,
        embedding: chunk.embedding,
      });
    }
  },
});

export const getDocument = query({
  args: {
    documentId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!session || session.expiry < Date.now()) {
      throw new Error("Unauthorized");
    }

    const user = await ctx.db.get(session.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const docId = ctx.db.normalizeId("documents", args.documentId);
    if (!docId) {
      throw new Error("Invalid document ID");
    }

    const doc = await ctx.db.get(docId);
    if (!doc || doc.userId !== session.userId) {
      throw new Error("Document not found");
    }

    return {
      id: doc._id,
      userId: doc.userId,
      whatsappNumber: user.whatsappNumber,
      title: doc.title,
      filename: doc.filename,
      documentType: doc.documentType,
      category: doc.category,
      summary: doc.summary,
      tags: doc.tags,
      mimeType: doc.mimeType,
      size: doc.size,
      r2Key: doc.r2Key,
      status: doc.status,
      failureReason: doc.failureReason ?? null,
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc._creationTime).toISOString(),
    };
  },
});


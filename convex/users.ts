import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const DEFAULT_PASSWORD = "12345678";

// Simple PBKDF2 SHA-256 password hashing helper that works in V8 environment
export async function hashPassword(password: string, salt: string = "magic-vault-salt-static"): Promise<string> {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedKeyBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: 10000,
      hash: "SHA-256",
    },
    passwordKey,
    256 // derived key size in bits (32 bytes)
  );

  const byteArray = new Uint8Array(derivedKeyBits);
  return Array.from(byteArray, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Generates a random session token
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const register = mutation({
  args: {
    whatsappNumber: v.string(),
    password: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Normalise number (strip + and non-digits)
    const normalizedNumber = args.whatsappNumber.replace(/\D/g, '');
    if (!normalizedNumber) {
      throw new Error("WhatsApp number is required");
    }

    if (args.password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }

    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_whatsappNumber", (q) => q.eq("whatsappNumber", normalizedNumber))
      .unique();

    let userId: any;

    if (existing) {
      // If user has already registered a password, block duplicate registration
      if (existing.passwordHash && existing.passwordHash.length > 0) {
        throw new Error("An account with this WhatsApp number already exists.");
      }

      // If user was auto-created from WhatsApp without password, complete registration
      const passwordHash = await hashPassword(args.password, normalizedNumber);
      await ctx.db.patch(existing._id, {
        passwordHash,
        ...(args.name ? { name: args.name } : {}),
      });
      userId = existing._id;
    } else {
      const passwordHash = await hashPassword(args.password, normalizedNumber);
      userId = await ctx.db.insert("users", {
        whatsappNumber: normalizedNumber,
        passwordHash,
        name: args.name,
        createdAt: Date.now(),
      });
    }

    const token = generateToken();
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

    await ctx.db.insert("sessions", {
      userId,
      token,
      expiry,
    });

    return {
      token,
      user: {
        id: userId,
        whatsappNumber: normalizedNumber,
        name: args.name ?? null,
      },
    };
  },
});

export const login = mutation({
  args: {
    whatsappNumber: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedNumber = args.whatsappNumber.replace(/\D/g, '');
    const user = await ctx.db
      .query("users")
      .withIndex("by_whatsappNumber", (q) => q.eq("whatsappNumber", normalizedNumber))
      .unique();

    if (!user || !user.passwordHash) {
      throw new Error("Invalid phone number or password.");
    }

    const passwordHash = await hashPassword(args.password, normalizedNumber);
    if (user.passwordHash !== passwordHash) {
      throw new Error("Invalid phone number or password.");
    }

    const token = generateToken();
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

    await ctx.db.insert("sessions", {
      userId: user._id,
      token,
      expiry,
    });

    return {
      token,
      user: {
        id: user._id,
        whatsappNumber: user.whatsappNumber,
        name: user.name ?? null,
      },
    };
  },
});

export const getUserByToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!session || session.expiry < Date.now()) {
      return null;
    }

    const user = await ctx.db.get(session.userId);
    if (!user) {
      return null;
    }

    return {
      id: user._id,
      whatsappNumber: user.whatsappNumber,
      name: user.name ?? null,
    };
  },
});

export const getUserByWhatsApp = query({
  args: {
    whatsappNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedNumber = args.whatsappNumber.replace(/\D/g, '');
    const user = await ctx.db
      .query("users")
      .withIndex("by_whatsappNumber", (q) => q.eq("whatsappNumber", normalizedNumber))
      .unique();

    if (!user) return null;

    return {
      id: user._id,
      whatsappNumber: user.whatsappNumber,
      isRegistered: !!(user.passwordHash && user.passwordHash.length > 0),
    };
  },
});
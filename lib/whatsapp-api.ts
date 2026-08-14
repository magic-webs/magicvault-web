/**
 * WhatsApp Business API helper
 * Uses the MagicXBot API proxy with the configured credentials.
 * API base: https://crm.magicxbot.com/api/meta
 */

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || "https://crm.magicxbot.com/api/meta";
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v19.0";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";

function getMessagesUrl(): string {
  return `${WHATSAPP_API_URL}/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

function getAuthHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
  };
}

/**
 * Send a plain text message to a WhatsApp number.
 */
export async function sendWhatsAppText(to: string, body: string): Promise<any> {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body },
  };

  const res = await fetch(getMessagesUrl(), {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[WhatsApp] Failed to send text message:", errorText);
    throw new Error(`WhatsApp API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

/**
 * Send a document message to a WhatsApp number via a public download URL.
 */
export async function sendWhatsAppDocument(
  to: string,
  link: string,
  filename: string,
  caption?: string
): Promise<void> {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "document",
    document: {
      link,
      filename,
      ...(caption ? { caption } : {}),
    },
  };

  const res = await fetch(getMessagesUrl(), {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[WhatsApp] Failed to send document message:", errorText);
    throw new Error(`WhatsApp API error ${res.status}: ${errorText}`);
  }
}

/**
 * Send a generic WhatsApp message payload (for advanced use).
 */
export async function sendWhatsAppMessage(payload: Record<string, unknown>): Promise<unknown> {
  const fullPayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...payload,
  };

  const res = await fetch(getMessagesUrl(), {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(fullPayload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[WhatsApp] Failed to send message:", errorText);
    throw new Error(`WhatsApp API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

/**
 * Fetch and download WhatsApp media by mediaId as base64 string.
 */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ base64: string; mimeType: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || WHATSAPP_ACCESS_TOKEN;
  const version = process.env.WHATSAPP_API_VERSION || WHATSAPP_API_VERSION;

  // Direct media fetch via MagicXBot CRM proxy (returns raw binary JPEG/PDF/Audio buffer)
  const proxyUrl = `https://crm.magicxbot.com/api/meta/${version}/${mediaId}`;
  
  try {
    const res = await fetch(proxyUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "curl/7.64.1",
      },
    });

    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await res.json();
        if (json.url) {
          const binRes = await fetch(json.url, { headers: { Authorization: `Bearer ${token}` } });
          const arrayBuffer = await binRes.arrayBuffer();
          return {
            base64: Buffer.from(arrayBuffer).toString("base64"),
            mimeType: json.mime_type || "application/octet-stream",
          };
        }
      } else {
        // Direct binary stream (JPEG, PNG, PDF, Audio)
        const arrayBuffer = await res.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        const mimeType = contentType.split(";")[0].trim() || "image/jpeg";
        return { base64, mimeType };
      }
    }
  } catch (err) {
    console.warn("[WhatsApp API] Proxy media download failed, trying Graph API fallback...", err);
  }

  // Fallback to graph.facebook.com
  const metaUrl = `https://graph.facebook.com/${version}/${mediaId}`;
  const resMeta = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resMeta.ok) {
    throw new Error(`Failed to fetch media metadata for ID ${mediaId}: ${resMeta.status} ${resMeta.statusText}`);
  }

  const metaData = await resMeta.json();
  const downloadUrl = metaData.url;
  const mimeType = metaData.mime_type || "application/octet-stream";

  const resMedia = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resMedia.ok) {
    throw new Error(`Failed to download media file: ${resMedia.statusText}`);
  }

  const arrayBuffer = await resMedia.arrayBuffer();
  return {
    base64: Buffer.from(arrayBuffer).toString("base64"),
    mimeType,
  };
}

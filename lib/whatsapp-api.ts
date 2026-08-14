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
  const baseUrl = process.env.WHATSAPP_API_URL || WHATSAPP_API_URL;

  const candidateUrls = [
    `https://graph.facebook.com/${version}/${mediaId}`,
    `${baseUrl}/${version}/${mediaId}`,
    `https://graph.facebook.com/${version}/${mediaId}?access_token=${encodeURIComponent(token)}`,
    `${baseUrl}/${version}/${mediaId}?access_token=${encodeURIComponent(token)}`,
  ];

  let metaData: any = null;
  let lastErr: string = "";

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "curl/7.64.1",
        },
      });
      if (res.ok) {
        metaData = await res.json();
        if (metaData && metaData.url) {
          break;
        }
      } else {
        lastErr = `${res.status} ${res.statusText}`;
      }
    } catch (e: any) {
      lastErr = e.message;
    }
  }

  if (!metaData || !metaData.url) {
    throw new Error(`Failed to fetch media metadata for ID ${mediaId}: ${lastErr || "Unauthorized"}`);
  }

  const downloadUrl = metaData.url;
  const mimeType = metaData.mime_type || "application/octet-stream";

  // Step 2: Download binary stream
  const resMedia = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "curl/7.64.1",
    },
  });

  if (!resMedia.ok) {
    // Try with access_token query param if Bearer header fails
    const separator = downloadUrl.includes("?") ? "&" : "?";
    const fallbackRes = await fetch(`${downloadUrl}${separator}access_token=${encodeURIComponent(token)}`, {
      headers: { "User-Agent": "curl/7.64.1" },
    });

    if (!fallbackRes.ok) {
      throw new Error(`Failed to download media file: ${resMedia.statusText}`);
    }

    const arrayBuffer = await fallbackRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return { base64, mimeType };
  }

  const arrayBuffer = await resMedia.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return { base64, mimeType };
}

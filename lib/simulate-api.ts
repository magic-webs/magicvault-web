const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export type SimulateReply =
  | { type: 'text'; text: string }
  | { type: 'document'; filename: string; mimeType: string; caption: string; downloadUrl: string }
  | { type: 'voice'; audioUrl: string; durationSec: number }

export interface SimulateResponseData {
  inbound: { kind: 'text' | 'voice' | 'upload'; transcript?: string }
  replies: SimulateReply[]
}

export type SimulateRequest =
  | { kind: 'text'; whatsappNumber: string; text: string }
  | { kind: 'voice'; whatsappNumber: string; audio: { base64: string; mimeType: string } }
  | { kind: 'upload'; whatsappNumber: string; file: { base64: string; mimeType: string; filename?: string } }

export class SimulateApiError extends Error {}

export async function simulateMessage(body: SimulateRequest): Promise<SimulateResponseData> {
  const res = await fetch(`${API_URL}/api/simulate/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new SimulateApiError(json?.error?.message ?? `Request failed with status ${res.status}`)
  }
  return json.data as SimulateResponseData
}

/** Reads a File/Blob into a base64 string (no data: prefix), for inline JSON transport. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

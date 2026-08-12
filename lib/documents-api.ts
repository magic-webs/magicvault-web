import { getToken, AuthApiError } from './auth-api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

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
  contentHash: string;
  expiryDate: string | null;
  status: 'processing' | 'ready' | 'failed';
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListDocumentsResult {
  items: VaultDocument[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listDocuments(params?: {
  category?: string;
  documentType?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListDocumentsResult> {
  const token = getToken();
  if (!token) throw new AuthApiError('No session token');

  const query = new URLSearchParams();
  if (params?.category) query.set('category', params.category);
  if (params?.documentType) query.set('documentType', params.documentType);
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', params.page.toString());
  if (params?.pageSize) query.set('pageSize', params.pageSize.toString());

  const queryString = query.toString() ? `?${query.toString()}` : '';
  const res = await fetch(`${API_URL}/api/documents${queryString}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new AuthApiError(json?.error?.message ?? `Failed to fetch documents`);
  }
  return json.data as ListDocumentsResult;
}

export async function getDownloadLink(documentId: string): Promise<string> {
  const token = getToken();
  if (!token) throw new AuthApiError('No session token');

  const res = await fetch(`${API_URL}/api/documents/${documentId}/download-link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new AuthApiError(json?.error?.message ?? `Failed to generate download link`);
  }
  return json.data.downloadUrl as string;
}

export async function getDocument(documentId: string): Promise<VaultDocument> {
  const token = getToken();
  if (!token) throw new AuthApiError('No session token');

  const res = await fetch(`${API_URL}/api/documents/${documentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new AuthApiError(json?.error?.message ?? `Failed to fetch document details`);
  }
  return json.data as VaultDocument;
}

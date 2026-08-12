const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export interface AuthUser {
  id: string
  whatsappNumber: string
  name: string | null
}

export interface AuthResult {
  token: string
  user: AuthUser
}

export class AuthApiError extends Error {}

async function post(path: string, body: unknown): Promise<AuthResult> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new AuthApiError(json?.error?.message ?? `Request failed with status ${res.status}`)
  }
  return json.data as AuthResult
}

export function register(whatsappNumber: string, password: string, name?: string): Promise<AuthResult> {
  return post('/api/auth/register', { whatsappNumber, password, name })
}

export function login(whatsappNumber: string, password: string): Promise<AuthResult> {
  return post('/api/auth/login', { whatsappNumber, password })
}

export async function getMe(): Promise<AuthUser> {
  const token = getToken()
  if (!token) throw new AuthApiError('No session token')
  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new AuthApiError(json?.error?.message ?? `Failed to fetch profile`)
  }
  const user = json.data.user as AuthUser
  if (typeof window !== 'undefined') {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  }
  return user
}

const TOKEN_KEY = 'magic-vault-token'
const USER_KEY = 'magic-vault-user'

export function saveSession(result: AuthResult): void {
  localStorage.setItem(TOKEN_KEY, result.token)
  localStorage.setItem(USER_KEY, JSON.stringify(result.user))
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  return raw ? (JSON.parse(raw) as AuthUser) : null
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

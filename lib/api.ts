// GAS ウェブアプリ（gas/Code.gs）との通信

export const API_URL = process.env.NEXT_PUBLIC_GAS_API_URL ?? ''
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://cbed.fsif.jp/').replace(/\/?$/, '/')
export const ACTIONS_URL = 'https://github.com/cosmo-base/event_database/actions'

const SESSION_KEY = 'cbed-admin-session'

export type Session = { token: string; name: string }

export class ApiError extends Error {
  code?: string
  data?: any
  constructor(message: string, code?: string, data?: any) {
    super(message)
    this.code = code
    this.data = data
  }
}

let onAuthExpired: (() => void) | null = null
export function setAuthExpiredHandler(fn: () => void) {
  onAuthExpired = fn
}

export function loadSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 成功時はレスポンスをそのまま返す。ok:false のときは ApiError を投げる
 * （duplicate / conflict などは error.data で中身を参照できる）。
 */
export async function api<T = any>(action: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<T> {
  if (!API_URL) throw new ApiError('GAS の URL（NEXT_PUBLIC_GAS_API_URL）が設定されていません')
  const session = loadSession()
  let res: Response
  try {
    // Content-Type を付けない（text/plain）ことで CORS のプリフライトを回避する
    res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, params, token: session?.token, ...extra }),
      redirect: 'follow',
    })
  } catch {
    throw new ApiError('サーバーに接続できませんでした。通信状況を確認してください')
  }
  let data: any
  try {
    data = await res.json()
  } catch {
    throw new ApiError(`サーバーの応答を読み取れませんでした (${res.status})`)
  }
  if (!data?.ok) {
    if (data?.code === 'AUTH') {
      saveSession(null)
      onAuthExpired?.()
    }
    throw new ApiError(data?.error || 'エラーが発生しました', data?.code, data)
  }
  return data as T
}

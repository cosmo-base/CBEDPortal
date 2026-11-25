// GAS ウェブアプリ（gas/Code.gs）との通信。ログインのセッション（7日。古い GAS なら Google の ID トークン）を全リクエストに付ける
import { credentialField, expireToken, type Credential, type SessionResult } from './google-auth'

export const API_URL = process.env.NEXT_PUBLIC_GAS_API_URL ?? ''
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://cbed.fsif.jp/').replace(/\/?$/, '/')
export const ACTIONS_URL = 'https://github.com/cosmo-base/event_database/actions'

/** ログインしている人（GAS が Access Manager で確かめた名前とメール） */
export type Session = { email: string; name: string }

export class ApiError extends Error {
  code?: string
  data?: any
  constructor(message: string, code?: string, data?: any) {
    super(message)
    this.code = code
    this.data = data
  }
}

/**
 * 成功時はレスポンスをそのまま返す。ok:false のときは ApiError を投げる
 * （duplicate / conflict などは error.data で中身を参照できる）。
 */
export async function api<T = any>(action: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<T> {
  if (!API_URL) throw new ApiError('GAS の URL（NEXT_PUBLIC_GAS_API_URL）が設定されていません')
  let res: Response
  try {
    // Content-Type を付けない（text/plain）ことで CORS のプリフライトを回避する
    res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, params, ...credentialField(), ...extra }),
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
    // AUTH：トークンの期限切れなど。ログイン画面に戻す
    if (data?.code === 'AUTH') expireToken()
    throw new ApiError(data?.error || 'エラーが発生しました', data?.code, data)
  }
  return data as T
}

/**
 * ログインを始める：Google の ID トークンかポータルの引換券を渡し、7日もつセッションをもらう。
 * 古い GAS（startSession が無い）なら null（ID トークンをそのまま使う）
 */
export async function startSession(cred: Credential): Promise<SessionResult> {
  if (!API_URL) throw new ApiError('GAS の URL（NEXT_PUBLIC_GAS_API_URL）が設定されていません')
  let data: any
  try {
    const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'startSession', params: {}, ...cred }), redirect: 'follow' })
    data = await res.json()
  } catch {
    throw new ApiError('サーバーに接続できませんでした。通信状況を確認してください', 'NETWORK')
  }
  if (data?.ok) return { session: String(data.session), expiresAt: String(data.expiresAt) }
  if (String(data?.error || '').startsWith('不明な操作です')) return null
  throw new ApiError(data?.error || 'エラーが発生しました', data?.code, data)
}

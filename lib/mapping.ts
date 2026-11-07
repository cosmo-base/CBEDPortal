// スプレッドシートの行 ⇔ 画面のフォーム の変換
import type { EventItem, LaunchItem, LocationMethod } from './types'

/** シート（シート1）の1行。GAS の rowToEvent_ / listEvents_ が返す形 */
export type SheetEvent = {
  id: string
  title: string
  date: string
  endDate?: string
  time?: string
  location?: string
  lat?: string
  lng?: string
  type?: string
  difficulty?: string
  capacity?: string
  description?: string
  speaker?: string
  organizer?: string
  link?: string
  isPartner?: boolean
  isRecommend?: boolean
  都道府県?: string
  更新日時?: string
  _rev?: string
}

const ONLINE = 'オンライン'
const TIME_RANGE = /^(\d{1,2})[:：](\d{2})\s*[-–~〜～ー]\s*(\d{1,2})[:：](\d{2})$/
const TIME_SINGLE = /^(\d{1,2})[:：](\d{2})(?:\s*[-–~〜～ー])?$/

const hhmm = (h: string, m: string) => `${h.padStart(2, '0')}:${m}`

export function parseTime(raw: string): Pick<EventItem, 'startTime' | 'endTime' | 'allDay' | 'timeUndecided' | 'rawTime'> {
  const t = (raw || '').trim()
  if (!t || /^(時刻)?未定$/.test(t)) return { timeUndecided: !!t }
  if (t === '終日') return { allDay: true }
  let m = t.match(TIME_RANGE)
  if (m) return { startTime: hhmm(m[1], m[2]), endTime: hhmm(m[3], m[4]) }
  m = t.match(TIME_SINGLE)
  if (m) return { startTime: hhmm(m[1], m[2]) }
  return { rawTime: t }
}

export function formatTime(e: Pick<EventItem, 'startTime' | 'endTime' | 'allDay' | 'timeUndecided' | 'rawTime'>): string {
  if (e.allDay) return '終日'
  if (e.timeUndecided) return '時刻未定'
  if (e.startTime) return e.endTime ? `${e.startTime} - ${e.endTime}` : e.startTime
  return e.rawTime || ''
}

export function splitTypes(type?: string): string[] {
  return String(type || '')
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function sheetToEvent(s: SheetEvent): EventItem {
  const types = splitTypes(s.type)
  const isOnlineOnly = (s.location || '').trim() === ONLINE
  const method: LocationMethod = isOnlineOnly ? 'オンライン' : types.includes(ONLINE) ? 'ハイブリッド' : '現地'
  return {
    id: String(s.id),
    title: s.title || '',
    date: s.date || '',
    endDate: s.endDate || '',
    ...parseTime(s.time || ''),
    locationMethod: method,
    location: isOnlineOnly ? '' : s.location || '',
    prefecture: s['都道府県'] || '',
    lat: s.lat != null ? String(s.lat) : '',
    lng: s.lng != null ? String(s.lng) : '',
    // 「オンライン」は開催方法で表現する
    types: types.filter((t) => t !== ONLINE),
    difficulty: s.difficulty || '',
    capacity: s.capacity || '',
    description: s.description || '',
    speaker: s.speaker || '',
    organizer: s.organizer || '',
    link: s.link || '',
    isPartner: !!s.isPartner,
    isRecommend: !!s.isRecommend,
    updatedAt: s['更新日時'] || '',
    rev: s._rev || '',
  }
}

/** GAS の create / update に渡す形 */
export function eventToSheet(e: EventItem) {
  const online = e.locationMethod === 'オンライン'
  const types = e.types.filter((t) => t !== ONLINE)
  if (e.locationMethod !== '現地') types.unshift(ONLINE)
  return {
    title: e.title,
    date: e.date,
    endDate: e.endDate || '',
    time: formatTime(e),
    location: online ? ONLINE : e.location,
    lat: e.lat || '',
    lng: e.lng || '',
    type: types,
    difficulty: e.difficulty,
    capacity: e.capacity || '',
    description: e.description || '',
    speaker: e.speaker || '',
    organizer: e.organizer,
    link: e.link || '',
    isPartner: e.isPartner,
    isRecommend: e.isRecommend,
    都道府県: e.prefecture || (online ? ONLINE : ''),
  }
}

export type SheetLaunch = { id: string; title: string; date: string; time: string; location: string; rocket: string; description: string; link: string }

export function sheetToLaunch(s: SheetLaunch): LaunchItem {
  const t = (s.time || '').trim()
  return {
    id: String(s.id),
    title: s.title || '',
    date: s.date || '',
    time: /^(時刻)?未定$/.test(t) ? '' : t,
    timeUndecided: /^(時刻)?未定$/.test(t),
    location: s.location || '',
    rocket: s.rocket || '',
    description: s.description || '',
    link: s.link || '',
  }
}

export function launchToSheet(l: LaunchItem) {
  return {
    title: l.title,
    date: l.date || '',
    time: l.timeUndecided ? '未定' : l.time || '',
    location: l.location,
    rocket: l.rocket,
    description: l.description || '',
    link: l.link || '',
  }
}

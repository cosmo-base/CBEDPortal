// 「URLから」「文章から」の入力候補づくり（ルールベース。外部AIは使わない）
import { launchSites, prefectures } from './types'

export type Suggestion = {
  key: string
  label: string
  value: string | string[]
}

export type FetchedPage = {
  url: string
  title: string
  meta: Record<string, string>
  jsonld: unknown[]
  text: string
}

const z2h = (s: string) => s.replace(/[０-９：／－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
const pad = (n: number | string) => String(n).padStart(2, '0')
const clean = (s?: string) => (s || '').replace(/\s+/g, ' ').trim()

function toIsoDate(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return ''
  return `${y}-${pad(m)}-${pad(d)}`
}

/** 本文中の日付をすべて抽出（年なしは今日以降の直近の年を補う） */
export function findDates(text: string): string[] {
  const t = z2h(text)
  const out: string[] = []
  const withYear = /(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?/g
  let m: RegExpExecArray | null
  while ((m = withYear.exec(t))) out.push(toIsoDate(+m[1], +m[2], +m[3]))
  if (!out.length) {
    const noYear = /(?<![\d/])(\d{1,2})\s*[月/]\s*(\d{1,2})\s*日?\s*[(（]/g
    const now = new Date()
    while ((m = noYear.exec(t))) {
      let y = now.getFullYear()
      const candidate = new Date(y, +m[1] - 1, +m[2])
      if (candidate.getTime() < now.getTime() - 30 * 86400000) y += 1
      out.push(toIsoDate(y, +m[1], +m[2]))
    }
  }
  return out.filter(Boolean)
}

export function findTimes(text: string): { start?: string; end?: string } {
  const t = z2h(text)
  const range = t.match(/(\d{1,2})[:時](\d{2})?\s*分?\s*[〜~\-–ー]\s*(\d{1,2})[:時](\d{2})?/)
  if (range) return { start: `${pad(range[1])}:${range[2] || '00'}`, end: `${pad(range[3])}:${range[4] || '00'}` }
  const single = t.match(/(?:開始|開演|スタート|時間)[^\d\n]{0,6}(\d{1,2}):(\d{2})/) || t.match(/(\d{1,2}):(\d{2})/)
  if (single) return { start: `${pad(single[1])}:${single[2]}` }
  return {}
}

function labeled(text: string, labels: string[]): string {
  const re = new RegExp(`(?:^|\\n|\\s)[【\\[■●◆・]?\\s*(?:${labels.join('|')})\\s*[】\\]]?\\s*[:：]?\\s*([^\\n]{2,80})`)
  const m = text.match(re)
  return m ? clean(m[1]).replace(/^[:：]\s*/, '') : ''
}

function findPrefecture(text: string) {
  return prefectures.slice(2).find((p) => text.includes(p)) || ''
}

function isoFromDateTime(v?: string) {
  if (!v) return { date: '', time: '' }
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : '' } : { date: '', time: '' }
}

/** JSON-LD の中から schema.org/Event を探す */
function findLdEvent(jsonld: unknown[]): any {
  const stack: any[] = [...jsonld]
  while (stack.length) {
    const x = stack.shift()
    if (!x || typeof x !== 'object') continue
    if (Array.isArray(x)) { stack.push(...x); continue }
    const type = ([] as string[]).concat(x['@type'] || [])
    if (type.some((t) => /Event$/.test(String(t)))) return x
    if (x['@graph']) stack.push(x['@graph'])
  }
  return null
}

type EventDraft = Record<string, string | string[]>

export function extractEvent(input: { text: string; page?: FetchedPage; knownTypes: string[] }): Suggestion[] {
  const { page, knownTypes } = input
  const text = page ? `${page.title}\n${page.meta['og:description'] || page.meta.description || ''}\n${page.text}` : input.text
  const draft: EventDraft = {}

  const ld = page ? findLdEvent(page.jsonld) : null
  if (ld) {
    const s = isoFromDateTime(ld.startDate)
    const e = isoFromDateTime(ld.endDate)
    if (ld.name) draft.title = clean(ld.name)
    if (s.date) draft.date = s.date
    if (e.date && e.date !== s.date) draft.endDate = e.date
    if (s.time) draft.startTime = s.time
    if (e.time) draft.endTime = e.time
    const loc = Array.isArray(ld.location) ? ld.location[0] : ld.location
    if (loc?.name) draft.location = clean(loc.name)
    const addr = loc?.address
    if (typeof addr === 'string') draft.address = clean(addr)
    else if (addr) draft.address = clean([addr.addressRegion, addr.addressLocality, addr.streetAddress].filter(Boolean).join(''))
    if (/Online/i.test(String(ld.eventAttendanceMode || '')) || loc?.['@type'] === 'VirtualLocation') {
      draft.locationMethod = /Mixed/i.test(String(ld.eventAttendanceMode || '')) ? 'ハイブリッド' : 'オンライン'
    }
    const org = Array.isArray(ld.organizer) ? ld.organizer[0] : ld.organizer
    if (org?.name) draft.organizer = clean(org.name)
    const perf = Array.isArray(ld.performer) ? ld.performer.map((p: any) => p?.name).filter(Boolean).join('、') : ld.performer?.name
    if (perf) draft.speaker = clean(perf)
    if (ld.description) draft.description = String(ld.description).trim()
  }

  if (!draft.title) {
    const t = page ? page.meta['og:title'] || page.title : text.split('\n').map(clean).find((l) => l.length >= 4) || ''
    if (t) draft.title = clean(t.replace(/\s*[|｜–-]\s*(Peatix|connpass|Doorkeeper|PassMarket|TECH PLAY).*$/i, '')).slice(0, 100)
  }
  if (!draft.date) {
    const dates = findDates(text)
    if (dates[0]) draft.date = dates[0]
  }
  if (!draft.startTime) {
    const t = findTimes(text)
    if (t.start) draft.startTime = t.start
    if (t.end) draft.endTime = t.end
  }
  if (!draft.location) {
    const loc = labeled(text, ['会場', '開催場所', '場所', '会場名'])
    if (loc) draft.location = loc.replace(/[（(].*$/, '').trim() || loc
  }
  if (!draft.address) {
    const addr = labeled(text, ['住所', '所在地', 'アクセス'])
    if (addr && findPrefecture(addr)) draft.address = addr
  }
  if (!draft.organizer) {
    const org = labeled(text, ['主催者?', '主催団体', '運営'])
    if (org) draft.organizer = org
  }
  if (!draft.speaker) {
    const sp = labeled(text, ['講師', '登壇者', '出演者?', 'ゲスト', '講演者'])
    if (sp) draft.speaker = sp
  }
  const cap = z2h(text).match(/定員\s*[:：]?\s*(?:先着)?\s*(\d+)\s*(名|人)?/)
  if (cap) draft.capacity = cap[1] + (cap[2] ? '名' : '')

  const pref = findPrefecture(String(draft.address || '') + String(draft.location || '')) || findPrefecture(text)
  if (pref) draft.prefecture = pref

  if (!draft.locationMethod && /オンライン|Zoom|YouTube\s*Live|配信|ウェビナー/i.test(text)) {
    draft.locationMethod = draft.location && !/オンライン/.test(String(draft.location)) ? 'ハイブリッド' : 'オンライン'
  }

  const types = knownTypes.filter((t) => t !== 'オンライン' && text.includes(t))
  if (types.length) draft.types = types.slice(0, 3)

  if (!draft.description && page) {
    const d = page.meta['og:description'] || page.meta.description
    if (d) draft.description = d.trim()
  }
  if (page) draft.link = page.url
  else {
    const url = text.match(/https?:\/\/[^\s<>"'）)]+/)
    if (url) draft.link = url[0]
  }

  return toSuggestions(draft, EVENT_LABELS)
}

export function extractLaunch(input: { text: string; page?: FetchedPage }): Suggestion[] {
  const { page } = input
  const text = page ? `${page.title}\n${page.meta['og:description'] || ''}\n${page.text}` : input.text
  const draft: EventDraft = {}
  const t = z2h(text)

  const rocket = t.match(/(H3|H-?IIA|H-?2A|H-?IIB|イプシロン|Epsilon|カイロス|KAIROS|ZERO|Falcon\s?9|Falcon Heavy|Starship|Electron|Vega|Ariane\s?6|Soyuz|SLS)\s*(?:ロケット)?\s*(\d+\s*号機|F\d+|\d+号)?/i)
  if (rocket) draft.rocket = clean(`${rocket[1]} ${rocket[2] || ''}`)
  const title = page ? page.meta['og:title'] || page.title : text.split('\n').map(clean).find((l) => l.length >= 4) || ''
  if (title) draft.title = clean(title).slice(0, 100)
  else if (draft.rocket) draft.title = `${draft.rocket} 打ち上げ`

  const dates = findDates(text)
  if (dates[0]) draft.date = dates[0]
  const time = t.match(/(\d{1,2})時(\d{1,2})分/) || t.match(/(\d{1,2}):(\d{2})/)
  if (time) draft.time = `${+time[1]}:${pad(time[2])}`

  const site = launchSites.find((s) => text.includes(s.replace(/宇宙センター|宇宙空間観測所/, '')))
  if (site) draft.location = site
  if (page) draft.link = page.url
  if (page?.meta['og:description']) draft.description = page.meta['og:description'].trim()

  return toSuggestions(draft, LAUNCH_LABELS)
}

const EVENT_LABELS: Record<string, string> = {
  title: 'イベント名', date: '開始日', endDate: '終了日', startTime: '開始時刻', endTime: '終了時刻',
  locationMethod: '開催方法', location: '会場名', address: '住所', prefecture: '都道府県', types: 'イベント形式',
  organizer: '主催団体', speaker: '登壇者', capacity: '定員', description: '詳細説明', link: '詳細・申込URL',
}
const LAUNCH_LABELS: Record<string, string> = {
  title: '打ち上げタイトル', date: '予定日', time: '予定時刻', location: '射場', rocket: 'ロケット名・号機', description: '詳細説明', link: '公式情報URL',
}

function toSuggestions(draft: EventDraft, labels: Record<string, string>): Suggestion[] {
  return Object.keys(labels)
    .filter((k) => {
      const v = draft[k]
      return Array.isArray(v) ? v.length > 0 : !!v
    })
    .map((k) => ({ key: k, label: labels[k], value: draft[k] }))
}

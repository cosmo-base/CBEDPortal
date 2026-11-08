// 画面で扱うデータ型（スプレッドシートの列との対応は lib/mapping.ts）

export type LocationMethod = '現地' | 'オンライン' | 'ハイブリッド'

export type EventItem = {
  id: string
  title: string
  date: string
  endDate?: string
  startTime?: string
  endTime?: string
  timeUndecided?: boolean
  allDay?: boolean
  /** 時刻欄を解釈できなかったときの元の表記（時刻を入力し直さなければそのまま保存） */
  rawTime?: string
  locationMethod: LocationMethod
  location: string
  /** 位置取得用（シートには保存しない） */
  address?: string
  prefecture?: string
  lat?: string
  lng?: string
  types: string[]
  difficulty: string
  capacity?: string
  description?: string
  speaker?: string
  organizer: string
  link?: string
  isPartner: boolean
  isRecommend: boolean
  updatedAt?: string
  /** 編集開始時の行内容のハッシュ（同時編集の検知用） */
  rev?: string
  /** 新規登録時のみ: 同じ内容で別日にも登録する日付 */
  extraDates?: string[]
}

export type LaunchItem = {
  id: string
  title: string
  date?: string
  time?: string
  timeUndecided?: boolean
  location: string
  rocket: string
  description?: string
  link?: string
}

export type Target = 'events' | 'launches'

export type BuildInfo = { scheduled?: boolean; at?: string; delayMin?: number; error?: string }

export type Meta = {
  types: string[]
  difficulties: string[]
  organizers: string[]
  locations: Record<string, { lat: string; lng: string; pref: string }>
  nextId: number
  total: number
  pendingBuildAt: string
  /** EXPORT_KEY が設定済みで、ビルドが最新データを直接読める */
  fastBuild?: boolean
}

export type BuildRun = {
  id: number
  status: string
  conclusion: string | null
  event: string
  createdAt: string
  url: string
}

export const prefectures = ['オンライン', '海外', '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']

export const launchSites = ['種子島宇宙センター', '内之浦宇宙空間観測所', 'スペースポート紀伊', '北海道スペースポート']

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, FileText, Filter, Info,
  ClipboardCheck, EyeOff, LayoutList, Link2Off, Loader2, LogOut, MapPin, Pencil, Plus, RefreshCw, Rocket, RotateCcw, Search, Sparkles, Trash2, UploadCloud, X,
} from 'lucide-react'
import { ACTIONS_URL, ApiError, SITE_URL, Session, api, loadSession, saveSession, setAuthExpiredHandler } from '@/lib/api'
import { extractEvent, extractLaunch, FetchedPage, Suggestion } from '@/lib/extract'
import { eventToSheet, launchToSheet, SheetEvent, SheetLaunch, sheetToEvent, sheetToLaunch, formatTime } from '@/lib/mapping'
import { BuildInfo, BuildRun, EventItem, LaunchItem, LocationMethod, Meta, Target, launchSites, prefectures } from '@/lib/types'

type View = 'home' | 'list' | 'form' | 'detail' | 'review' | 'complete' | 'build' | 'audit'
type ImportMode = 'url' | 'text' | 'manual'
type Item = EventItem | LaunchItem
type SaveResult = { ids: string[]; build?: BuildInfo; isEvent: boolean; editing: boolean; title: string }
type Duplicate = { id: string; title: string; date: string; time?: string }

const PAGE_SIZE = 20
const DRAFT_KEY = 'cbed-admin-draft'

const todayJst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
const blankEvent = (): EventItem => ({ id: '', title: '', date: '', locationMethod: '現地', location: '', types: [], difficulty: '全レベル', organizer: '', isPartner: false, isRecommend: false })
const blankLaunch = (): LaunchItem => ({ id: '', title: '', date: '', location: '', rocket: '' })
const isEventItem = (x: Item): x is EventItem => 'types' in x
const siteEventUrl = (id: string) => `${SITE_URL}${encodeURIComponent(id)}/`

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'teal' | 'amber' | 'blue' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

function DateText({ item }: { item: Item }) {
  if (!item.date) return <span>日付未定</span>
  if (isEventItem(item)) {
    const range = item.endDate && item.endDate !== item.date ? `${item.date} 〜 ${item.endDate}` : item.date
    const time = formatTime(item)
    return <span>{range}{time ? ` ${time}` : ''}</span>
  }
  return <span>{item.date}{item.timeUndecided ? ' 時刻未定' : item.time ? ` ${item.time}` : ''}</span>
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ルート: ログイン状態で切り替え
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function Page() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setSession(loadSession())
    setReady(true)
    setAuthExpiredHandler(() => setSession(null))
  }, [])
  if (!ready) return null
  if (!session) return <LoginView onLogin={(s) => { saveSession(s); setSession(s) }} />
  return <Admin session={session} onLogout={() => { api('logout').catch(() => {}); saveSession(null); setSession(null) }} />
}

function LoginView({ onLogin }: { onLogin: (s: Session) => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { try { setName(localStorage.getItem('cbed-admin-name') || '') } catch { /* ignore */ } }, [])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api<{ token: string; name: string }>('login', {}, { name, password })
      try { localStorage.setItem('cbed-admin-name', r.name) } catch { /* ignore */ }
      onLogin({ token: r.token, name: r.name })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand static"><div className="brand-mark">CB</div><div><strong>Cosmo Base</strong><small>情報管理</small></div></div>
        <h1>ログイン</h1>
        <p className="muted">CBED（cbed.fsif.jp）のイベント・打ち上げ情報を管理します。</p>
        <Field label="担当者名" required><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" maxLength={40} placeholder="例：山田" required /></Field>
        <Field label="パスワード" required><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
        {error && <div className="error"><AlertTriangle />{error}</div>}
        <button className="primary wide" disabled={busy}>{busy ? <Loader2 className="spin" /> : null}ログイン</button>
      </form>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 管理画面
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function Admin({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [target, setTarget] = useState<Target>('events')
  const [view, setView] = useState<View>('home')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [events, setEvents] = useState<EventItem[] | null>(null)
  const [launches, setLaunches] = useState<LaunchItem[] | null>(null)
  const [listError, setListError] = useState('')
  const [selected, setSelected] = useState<Item | null>(null)
  const [original, setOriginal] = useState<Item | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Item>(blankEvent())
  const [mode, setMode] = useState<ImportMode>('url')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null)
  const [result, setResult] = useState<SaveResult | null>(null)
  const [pendingBuildAt, setPendingBuildAt] = useState('')
  const [flash, setFlash] = useState('')
  const isEvent = target === 'events'

  const loadMeta = useCallback(async () => {
    try {
      const r = await api<Meta>('meta')
      setMeta(r)
      setPendingBuildAt(r.pendingBuildAt || '')
    } catch (e) {
      setListError((e as Error).message)
    }
  }, [])

  const loadEvents = useCallback(async () => {
    setListError('')
    try {
      const r = await api<{ events: SheetEvent[] }>('list', { limit: 5000, sort: 'idDesc' })
      setEvents(r.events.map(sheetToEvent))
    } catch (e) {
      setListError((e as Error).message)
    }
  }, [])

  const loadLaunches = useCallback(async () => {
    setListError('')
    try {
      const r = await api<{ launches: SheetLaunch[] }>('launchList')
      setLaunches(r.launches.map(sheetToLaunch))
    } catch (e) {
      setListError((e as Error).message)
    }
  }, [])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => {
    if (view !== 'list') return
    if (isEvent && !events) loadEvents()
    if (!isEvent && !launches) loadLaunches()
  }, [view, isEvent, events, launches, loadEvents, loadLaunches])

  // 新規登録の下書きをブラウザに保存
  useEffect(() => {
    if ((view === 'form' || view === 'home') && !editing && !form.id && form.title) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ target, form })) } catch { /* ignore */ }
    }
  }, [form, view, editing, target])

  const resetForm = (t: Target) => {
    setForm(t === 'events' ? blankEvent() : blankLaunch())
    setEditing(false)
    setOriginal(null)
    setSelected(null)
    setMode('url')
    setError('')
    setDuplicates(null)
  }

  const changeTarget = (t: Target) => { setTarget(t); setFlash(''); setView('list') }
  const goHome = () => { setTarget('events'); resetForm('events'); restoreDraft('events'); setView('home') }
  const switchFormTarget = (t: Target) => { setTarget(t); resetForm(t); restoreDraft(t) }

  const restoreDraft = (t: Target) => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
      if (d && d.target === t && d.form?.title) setForm({ ...d.form, id: '' })
    } catch { /* ignore */ }
  }
  useEffect(() => { restoreDraft('events') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchFull = async (item: Item): Promise<Item> => {
    if (!isEventItem(item)) return item
    const r = await api<{ event: SheetEvent }>('get', { id: item.id })
    return sheetToEvent(r.event)
  }

  const goForm = async (item?: Item, duplicate = false) => {
    resetForm(target)
    if (item) {
      try {
        const full = await fetchFull(item)
        if (duplicate) {
          setForm(isEventItem(full) ? { ...full, id: '', isPartner: false, isRecommend: false, updatedAt: '', rev: '' } : { ...full, id: '' })
        } else {
          setForm(full)
          setOriginal(full)
          setEditing(true)
        }
        setMode('manual')
      } catch (e) {
        setError((e as Error).message)
      }
    }
    setView('form')
  }

  const openDetail = async (item: Item) => {
    setSelected(item)
    setView('detail')
    if (isEventItem(item)) {
      try { setSelected(await fetchFull(item)) } catch (e) { setError((e as Error).message) }
    }
  }

  const field = (key: string, value: unknown) => setForm((v) => ({ ...v, [key]: value }) as Item)

  const validate = (): string => {
    if (isEventItem(form)) {
      const f = form
      const missing: string[] = []
      if (!f.title.trim()) missing.push('イベント名')
      if (!f.types.length && f.locationMethod === '現地') missing.push('イベント形式')
      if (!f.difficulty) missing.push('対象レベル')
      if (!f.organizer.trim()) missing.push('主催団体名')
      if (!f.date) missing.push('開始日')
      if (!f.allDay && !f.timeUndecided && !f.startTime && !f.rawTime) missing.push('開始時刻（未定なら「時刻未定」）')
      if (f.locationMethod !== 'オンライン') {
        if (!f.location.trim()) missing.push('会場名')
        if (!f.lat || !f.lng) missing.push('位置（「位置を取得」または緯度・経度）')
      }
      if (missing.length) return `次の項目を入力してください：${missing.join('、')}`
      if (f.endDate && f.endDate < f.date) return '終了日が開始日より前になっています'
      if (f.startTime && f.endTime && !f.endDate && f.endTime < f.startTime) return '終了時刻が開始時刻より前になっています'
      if (f.link && !/^https?:\/\//i.test(f.link)) return 'URLは http(s):// から始まる形で入力してください'
      if (!editing && f.date < todayJst()) return '過去の日付です。内容を確認してから登録してください'
      return ''
    }
    const l = form
    if (!l.title.trim()) return '打ち上げタイトルを入力してください'
    if (!l.date) return '打ち上げ予定日を入力してください（日付が空だとサイトのカレンダーに表示できません）'
    if (l.link && !/^https?:\/\//i.test(l.link)) return 'URLは http(s):// から始まる形で入力してください'
    return ''
  }

  const submit = () => {
    const msg = validate()
    setError(msg)
    if (msg) { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); return }
    setDuplicates(null)
    setView('review')
    window.scrollTo({ top: 0 })
  }

  const save = async (force = false) => {
    setSaving(true)
    setError('')
    try {
      let r: { ids?: (string | number)[]; id?: string | number; build?: BuildInfo }
      if (isEventItem(form)) {
        const event = eventToSheet(form)
        r = editing
          ? await api('update', { id: form.id, event, expectedRev: (original as EventItem | null)?.rev ?? '' })
          : await api('create', { event, dates: form.extraDates || [], force })
      } else {
        const launch = launchToSheet(form)
        r = editing
          ? await api('launchUpdate', { id: form.id, launch, expectedTitle: (original as LaunchItem | null)?.title ?? '' })
          : await api('launchCreate', { launch, force })
      }
      const ids = (r.ids || [r.id]).filter((x) => x != null).map(String)
      setResult({ ids, build: r.build, isEvent, editing, title: form.title })
      if (r.build?.at) setPendingBuildAt(r.build.at)
      if (!editing) { try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ } }
      // 一覧は次に開いたときに再取得
      if (isEvent) setEvents(null); else setLaunches(null)
      loadMeta()
      setView('complete')
    } catch (e) {
      const err = e as ApiError
      if (err.data?.duplicate) setDuplicates(err.data.duplicates)
      else setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  /** 非公開にする（サイトから外す）。行は「非公開」シートに移り、あとで戻せる */
  const archiveSelected = async (reason: string) => {
    if (!selected) return
    const r = isEventItem(selected)
      ? await api<{ build?: BuildInfo }>('archive', { id: selected.id, expectedRev: selected.rev ?? '', reason })
      : await api<{ build?: BuildInfo }>('launchArchive', { id: selected.id, expectedTitle: selected.title, reason })
    if (r.build?.at) setPendingBuildAt(r.build.at)
    if (isEventItem(selected)) setEvents(null); else setLaunches(null)
    setFlash(`「${selected.title}」を非公開にしました。サイトの反映後に表示されなくなります（一覧の「非公開」からいつでも戻せます）`)
    loadMeta()
    setView('list')
  }

  const onArchiveChanged = (build?: BuildInfo) => {
    if (build?.at) setPendingBuildAt(build.at)
    if (isEvent) setEvents(null); else setLaunches(null)
    loadMeta()
  }

  const editFromAudit = (id: string) => {
    setTarget('events')
    goForm({ ...blankEvent(), id })
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={goHome} aria-label="ホームへ戻る"><div className="brand-mark">CB</div><div><strong>Cosmo Base</strong><small>情報管理</small></div></button>
        <nav>
          <button className={view === 'home' ? 'active' : ''} onClick={goHome}><Plus />新規登録</button>
          <button className={!['home', 'build', 'audit'].includes(view) && isEvent ? 'active' : ''} onClick={() => changeTarget('events')}><LayoutList />イベント</button>
          <button className={!['home', 'build', 'audit'].includes(view) && !isEvent ? 'active' : ''} onClick={() => changeTarget('launches')}><Rocket />打ち上げ情報</button>
          <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}><ClipboardCheck />データ点検</button>
          <button className={view === 'build' ? 'active' : ''} onClick={() => setView('build')}><UploadCloud />サイト反映{pendingBuildAt && <span className="nav-dot" title="ビルド予約中" />}</button>
        </nav>
        <div className="sidebar-foot"><span className={`status-dot${pendingBuildAt ? ' pending' : ''}`} />{pendingBuildAt ? `${pendingBuildAt.slice(11)} に自動反映予定` : 'スプレッドシート連携中'}</div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="topbar-title">CBED 運営ページ</span>
          <div className="user-chip"><span>{session.name} さん</span><button className="link-btn" onClick={onLogout}><LogOut />ログアウト</button></div>
        </header>

        {(view === 'home' || view === 'form') && (
          <FormView
            home={view === 'home'} isEvent={isEvent} form={form} editing={editing} meta={meta} mode={mode} setMode={setMode} field={field} setForm={setForm}
            error={error} onBack={() => setView(editing ? 'detail' : 'list')} onSubmit={submit} onSwitchTarget={switchFormTarget}
            onClear={() => { resetForm(target); try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ } }}
          />
        )}
        {view === 'list' && (
          <ListView
            isEvent={isEvent} events={events} launches={launches} meta={meta} error={listError}
            flash={flash} onDismissFlash={() => setFlash('')} onArchiveChanged={onArchiveChanged}
            onReload={() => (isEvent ? loadEvents() : loadLaunches())}
            onNew={() => goForm()} onDetail={openDetail} onEdit={(x) => goForm(x)} onCopy={(x) => goForm(x, true)}
          />
        )}
        {view === 'review' && (
          <ReviewView isEvent={isEvent} form={form} original={original} editing={editing} saving={saving} duplicates={duplicates}
            onBack={() => { setDuplicates(null); setView('form') }} onSave={save} error={error} />
        )}
        {view === 'detail' && selected && (
          <DetailView item={selected} isEvent={isEvent} onBack={() => setView('list')} onEdit={() => goForm(selected)} onCopy={() => goForm(selected, true)} onArchive={archiveSelected} />
        )}
        {view === 'complete' && result && (
          <CompleteView result={result} onNew={() => { resetForm(target); setView('form') }} onList={() => setView('list')} onBuild={() => setView('build')} />
        )}
        {view === 'build' && <BuildView pendingBuildAt={pendingBuildAt} setPendingBuildAt={setPendingBuildAt} fastBuild={!!meta?.fastBuild} />}
        {view === 'audit' && <AuditView onEdit={editFromAudit} />}
      </main>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 一覧
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ListView(p: {
  isEvent: boolean; events: EventItem[] | null; launches: LaunchItem[] | null; meta: Meta | null; error: string
  flash: string; onDismissFlash: () => void; onArchiveChanged: (build?: BuildInfo) => void
  onReload: () => void; onNew: () => void; onDetail: (x: Item) => void; onEdit: (x: Item) => void; onCopy: (x: Item) => void
}) {
  const [scope, setScope] = useState<'active' | 'archived'>('active')
  const [query, setQuery] = useState('')
  const [past, setPast] = useState(false)
  const [sort, setSort] = useState('date')
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [areaFilter, setAreaFilter] = useState('')
  const [recFilter, setRecFilter] = useState('')
  const [partnerFilter, setPartnerFilter] = useState('')
  useEffect(() => { setPage(1) }, [query, past, sort, typeFilter, areaFilter, recFilter, partnerFilter, p.isEvent])

  const data: Item[] | null = p.isEvent ? p.events : p.launches
  const today = todayJst()
  const filtered = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data
      .filter((x) => {
        const text = isEventItem(x) ? [x.id, x.title, x.organizer, x.location, x.prefecture, x.speaker].join(' ') : [x.title, x.rocket, x.location].join(' ')
        if (q && !q.split(/\s+/).every((t) => text.toLowerCase().includes(t))) return false
        const last = isEventItem(x) ? x.endDate || x.date : x.date
        if (!past && last && last < today) return false
        if (isEventItem(x)) {
          if (typeFilter === 'オンライン' ? x.locationMethod === '現地' : typeFilter && !x.types.includes(typeFilter)) return false
          if (areaFilter && x.prefecture !== areaFilter) return false
          if (recFilter && String(x.isRecommend) !== recFilter) return false
          if (partnerFilter && String(x.isPartner) !== partnerFilter) return false
        }
        return true
      })
      .sort((a, b) => {
        if (sort === 'name') return a.title.localeCompare(b.title, 'ja')
        if (sort === 'id') return (Number(b.id) || 0) - (Number(a.id) || 0)
        return (a.date || '9999').localeCompare(b.date || '9999')
      })
  }, [data, query, past, sort, typeFilter, areaFilter, recFilter, partnerFilter, today])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const clear = () => { setQuery(''); setTypeFilter(''); setAreaFilter(''); setRecFilter(''); setPartnerFilter('') }

  return (
    <section className="content">
      <div className="page-head">
        <div>
          <p className="eyebrow">{p.isEvent ? 'EVENTS' : 'LAUNCHES'} / 管理一覧</p>
          <h1>{p.isEvent ? 'イベント' : '打ち上げ情報'}</h1>
          <p className="muted">{p.isEvent ? 'イベント情報を確認・編集・登録します。' : 'ロケット打ち上げ予定を確認・編集・登録します。'} <span className="jst">日時は日本時間（JST）</span></p>
        </div>
        <div className="head-actions">
          {scope === 'active' && <button className="secondary" onClick={p.onReload} title="スプレッドシートから再読み込み"><RefreshCw />再読み込み</button>}
          <button className="primary add-primary" onClick={p.onNew}><Plus />新規登録</button>
        </div>
      </div>
      {p.flash && <div className="notice flash"><Check /><span>{p.flash}</span><button className="link-btn" onClick={p.onDismissFlash} aria-label="閉じる"><X /></button></div>}
      <div className="import-tabs scope-tabs" role="tablist">
        <button role="tab" aria-selected={scope === 'active'} className={scope === 'active' ? 'selected' : ''} onClick={() => setScope('active')}><LayoutList />公開中</button>
        <button role="tab" aria-selected={scope === 'archived'} className={scope === 'archived' ? 'selected' : ''} onClick={() => setScope('archived')}><EyeOff />非公開</button>
      </div>
      {scope === 'archived' ? <ArchivedList key={String(p.isEvent)} isEvent={p.isEvent} onChanged={p.onArchiveChanged} /> : <>
      <div className="toolbar">
        <div className="search secondary-search"><span className="search-label">補助検索</span><Search />
          <input aria-label="検索" placeholder={p.isEvent ? 'ID・イベント名・主催者・会場を検索' : 'タイトル・ロケット・射場を検索'} value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button onClick={() => setQuery('')} aria-label="検索をクリア"><X /></button>}
        </div>
        <label className="check"><input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} />過去も表示</label>
        <label className="sort">並べ替え<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="date">日付順</option><option value="name">名称順</option>{p.isEvent && <option value="id">ID 新しい順</option>}</select></label>
        {p.isEvent && <button className={`filter-btn${showFilters ? ' selected' : ''}`} onClick={() => setShowFilters(!showFilters)}><Filter />フィルター</button>}
      </div>
      {p.isEvent && showFilters && (
        <div className="filter-row">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="">開催形式：すべて</option>{(p.meta?.types || []).map((t) => <option key={t}>{t}</option>)}</select>
          <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}><option value="">開催エリア：すべて</option>{prefectures.map((x) => <option key={x}>{x}</option>)}</select>
          <select value={recFilter} onChange={(e) => setRecFilter(e.target.value)}><option value="">おすすめ：すべて</option><option value="true">おすすめのみ</option><option value="false">おすすめ以外</option></select>
          <select value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)}><option value="">パートナー：すべて</option><option value="true">パートナーのみ</option><option value="false">パートナー以外</option></select>
        </div>
      )}
      {p.error && <div className="error"><AlertTriangle />{p.error}</div>}
      <div className="list-meta"><span>{data ? `${filtered.length}件` : '読み込み中…'}</span><span>スプレッドシートの内容を表示しています</span></div>
      {!data ? (
        <div className="empty"><Loader2 className="spin" /><h3>読み込み中…</h3></div>
      ) : rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr>{(p.isEvent ? ['イベント名', '開催日・時間', '形式', '会場・エリア', '主催者', '表示', ''] : ['タイトル', '打ち上げ予定（JST）', 'ロケット', '射場', '']).map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id} onClick={() => p.onDetail(x)}>
                  <td><strong>{x.title}</strong><small>{p.isEvent ? `ID ${x.id}` : `行 ${x.id}`}</small></td>
                  <td><DateText item={x} /></td>
                  {isEventItem(x) ? (
                    <>
                      <td><div className="chips">{x.locationMethod !== '現地' && <Badge tone="blue">{x.locationMethod}</Badge>}{x.types.map((t) => <Badge key={t}>{t}</Badge>)}</div></td>
                      <td>{x.locationMethod === 'オンライン' ? 'オンライン' : x.location}<small>{x.prefecture || '—'}</small></td>
                      <td>{x.organizer}</td>
                      <td>{x.isRecommend && <Badge tone="amber">おすすめ</Badge>} {x.isPartner && <Badge tone="teal">パートナー</Badge>}</td>
                    </>
                  ) : (
                    <>
                      <td>{x.rocket}</td>
                      <td>{x.location}</td>
                    </>
                  )}
                  <td>
                    <div className="row-actions">
                      <button title="詳細" onClick={(e) => { e.stopPropagation(); p.onDetail(x) }}><ExternalLink /></button>
                      <button title="編集" onClick={(e) => { e.stopPropagation(); p.onEdit(x) }}><Pencil /></button>
                      <button title="複製して新規登録" onClick={(e) => { e.stopPropagation(); p.onCopy(x) }}><Copy /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty"><Search /><h3>条件に一致する情報がありません</h3><p>検索条件をクリアするか、新規登録してください。</p><button className="secondary" onClick={clear}>条件をクリア</button><button className="primary" onClick={p.onNew}><Plus />新規登録</button></div>
      )}
      <div className="pagination">
        <span>{rows.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)}件を表示` : ''}</span>
        <div><button disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="前のページ"><ChevronLeft /></button><b>{page} / {pages}</b><button disabled={page === pages} onClick={() => setPage(page + 1)} aria-label="次のページ"><ChevronRight /></button></div>
      </div>
      </>}
    </section>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 登録・編集フォーム
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function FormView(p: {
  home: boolean; isEvent: boolean; form: Item; editing: boolean; meta: Meta | null; mode: ImportMode; setMode: (m: ImportMode) => void
  field: (k: string, v: unknown) => void; setForm: React.Dispatch<React.SetStateAction<Item>>; error: string
  onBack: () => void; onSubmit: () => void; onSwitchTarget: (t: Target) => void; onClear: () => void
}) {
  const f = p.form
  return (
    <section className="content">
      <div className="page-head">
        <div>
          {!p.home && <button className="back" onClick={p.onBack}><ChevronLeft />{p.editing ? '詳細へ戻る' : '一覧へ戻る'}</button>}
          <p className="eyebrow">{p.editing ? `編集 · ${p.isEvent ? `ID ${f.id}` : `行 ${f.id}`}` : '新規登録'}</p>
          <h1>{p.isEvent ? 'イベント情報' : '打ち上げ情報'}を{p.editing ? '編集' : '登録'}</h1>
          <p className="muted">{p.editing ? '変更内容は確認画面を経てスプレッドシートに保存されます。' : 'URLや案内文から入力候補を作って、フォームを補完できます。'}</p>
          {!p.editing && (
            <div className="home-type-switch form-type-switch" role="tablist" aria-label="登録する情報">
              <button role="tab" aria-selected={p.isEvent} className={p.isEvent ? 'active event-tab' : ''} onClick={() => p.onSwitchTarget('events')}><CalendarDays />イベント</button>
              <button role="tab" aria-selected={!p.isEvent} className={!p.isEvent ? 'active launch-tab' : ''} onClick={() => p.onSwitchTarget('launches')}><Rocket />ロケット</button>
            </div>
          )}
        </div>
        {!p.editing && f.title && <div className="head-actions"><button className="link-btn" onClick={p.onClear}><X />入力をクリア</button></div>}
      </div>
      {!p.editing && (
        <div className="import-tabs">
          <button className={p.mode === 'url' ? 'selected' : ''} onClick={() => p.setMode('url')}><ExternalLink />URLから</button>
          <button className={p.mode === 'text' ? 'selected' : ''} onClick={() => p.setMode('text')}><FileText />文章から</button>
          <button className={p.mode === 'manual' ? 'selected' : ''} onClick={() => p.setMode('manual')}><Pencil />手入力</button>
        </div>
      )}
      {!p.editing && p.mode !== 'manual' && <ImportBox key={`${p.mode}-${p.isEvent}`} mode={p.mode} isEvent={p.isEvent} meta={p.meta} form={f} setForm={p.setForm} />}
      <div className="form-layout">
        <div className="form-main">
          {isEventItem(f) ? <EventForm f={f} field={p.field} meta={p.meta} editing={p.editing} /> : <LaunchForm f={f} field={p.field} />}
          {p.error && <div className="error"><AlertTriangle />{p.error}</div>}
          <div className="form-footer">
            <button className="secondary" onClick={p.onBack}>キャンセル</button>
            <button className="primary" onClick={p.onSubmit}>内容を確認する <ChevronRight /></button>
          </div>
        </div>
        <aside className="summary">
          <div className="summary-title"><Info />入力サマリー</div>
          <strong>{f.title || 'タイトル未入力'}</strong>
          <div><DateText item={f} /></div>
          <div>{isEventItem(f) ? (f.locationMethod === 'オンライン' ? 'オンライン' : f.location || '会場未入力') : f.rocket || 'ロケット未入力'}</div>
          {isEventItem(f) && !p.editing && p.meta && <div className="muted">登録されるID：{p.meta.nextId}{f.extraDates?.length ? ` 〜 ${p.meta.nextId + f.extraDates.length}` : ''}</div>}
          <span className="muted">必須項目を埋めると確認できます</span>
        </aside>
      </div>
    </section>
  )
}

function ImportBox(p: { mode: ImportMode; isEvent: boolean; meta: Meta | null; form: Item; setForm: React.Dispatch<React.SetStateAction<Item>> }) {
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  const show = async () => {
    setError('')
    setSuggestions(null)
    if (!source.trim()) { setError(p.mode === 'url' ? 'URLを入力してください' : '案内文を貼り付けてください'); return }
    setLoading(true)
    try {
      let page: FetchedPage | undefined
      if (p.mode === 'url') page = await api<FetchedPage>('fetchUrl', { url: source.trim() })
      const s = p.isEvent ? extractEvent({ text: source, page, knownTypes: p.meta?.types || [] }) : extractLaunch({ text: source, page })
      if (!s.length) setError('入力候補を見つけられませんでした。手入力してください。')
      setSuggestions(s)
      setChecked(Object.fromEntries(s.map((x) => [x.key, true])))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const apply = (onlyEmpty: boolean) => {
    if (!suggestions) return
    p.setForm((v) => {
      const next: any = { ...v }
      suggestions.forEach((s) => {
        if (!checked[s.key]) return
        const cur = next[s.key]
        const isEmpty = Array.isArray(cur) ? cur.length === 0 : !cur || (s.key === 'locationMethod' && cur === '現地')
        if (onlyEmpty && !isEmpty) return
        next[s.key] = s.value
      })
      return next
    })
    setSuggestions(null)
  }

  return (
    <div className="import-box">
      <div className="import-title"><Sparkles /><div>
        <strong>{p.mode === 'url' ? 'URLから入力候補を表示' : '文章から入力候補を表示'}</strong>
        <p>{p.mode === 'url' ? 'ページの構造化データ・タイトル・本文から候補を作ります。内容は必ず確認してください。' : '案内文の「会場：」「主催：」などの書き方や日付・時刻から候補を作ります。'}</p>
      </div></div>
      {p.mode === 'url'
        ? <div className="inline-input"><input placeholder="https://peatix.com/event/..." value={source} onChange={(e) => setSource(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') show() }} /></div>
        : <textarea rows={4} placeholder="案内文を貼り付けてください" value={source} onChange={(e) => setSource(e.target.value)} />}
      <div className="import-actions">
        <button className="secondary" onClick={show} disabled={loading}>{loading ? <><Loader2 className="spin" />候補を作成中…</> : '入力候補を表示'}</button>
      </div>
      {error && <div className="error"><AlertTriangle />{error}</div>}
      {suggestions && suggestions.length > 0 && (
        <div className="suggestion">
          <div className="suggestion-head"><strong>入力候補（反映する項目を選んでください）</strong><span>{p.mode === 'url' ? source : '貼り付けた文章'}</span></div>
          <div className="suggestion-grid">
            {suggestions.map((s) => (
              <label key={s.key} className={checked[s.key] ? 'picked' : ''}>
                <span><input type="checkbox" checked={!!checked[s.key]} onChange={(e) => setChecked({ ...checked, [s.key]: e.target.checked })} /> {s.label}</span>
                <b>{Array.isArray(s.value) ? s.value.join('、') : s.value.length > 120 ? `${s.value.slice(0, 120)}…` : s.value}</b>
              </label>
            ))}
          </div>
          <div className="suggestion-actions">
            <button className="link-btn" onClick={() => apply(true)}>空欄だけに反映</button>
            <button className="secondary" onClick={() => apply(false)}><Check />選んだ項目を反映</button>
          </div>
        </div>
      )}
    </div>
  )
}

function EventForm({ f, field, meta, editing }: { f: EventItem; field: (k: string, v: unknown) => void; meta: Meta | null; editing: boolean }) {
  const types = (meta?.types || []).filter((t) => t !== 'オンライン')
  const difficulties = meta?.difficulties?.length ? meta.difficulties : ['全レベル', '初心者向け', '中級者向け', '上級者向け']
  const [extraInput, setExtraInput] = useState('')
  const onLocationChange = (v: string) => {
    field('location', v)
    const known = meta?.locations?.[v.trim()]
    if (known && !f.lat && known.lat) {
      field('lat', String(known.lat))
      field('lng', String(known.lng))
      if (!f.prefecture && known.pref) field('prefecture', known.pref)
    }
  }
  const timeLocked = !!f.timeUndecided || !!f.allDay
  return (
    <>
      <FormSection title="基本情報">
        <Field label="イベント名" required><input value={f.title} onChange={(e) => field('title', e.target.value)} placeholder="例：春の星空観測会" /></Field>
        <Field label="イベント形式" required hint="オンライン開催かどうかは「会場」の開催方法で選びます">
          <div className="chips-input">
            {types.map((x) => (
              <button type="button" key={x} className={f.types.includes(x) ? 'chip-selected' : ''} onClick={() => field('types', f.types.includes(x) ? f.types.filter((v) => v !== x) : [...f.types, x])}>{x}</button>
            ))}
            {!types.length && <span className="muted">読み込み中…</span>}
          </div>
        </Field>
        <div className="two-col">
          <Field label="対象レベル" required><select value={f.difficulty} onChange={(e) => field('difficulty', e.target.value)}><option value="">選択してください</option>{difficulties.map((d) => <option key={d}>{d}</option>)}</select></Field>
          <Field label="主催団体名" required hint="「Cosmo Base」を含むとサイトで主催イベント扱いになります">
            <input value={f.organizer} onChange={(e) => field('organizer', e.target.value)} placeholder="例：Cosmo Base運営事務局" list="organizer-list" />
            <datalist id="organizer-list">{(meta?.organizers || []).map((o) => <option key={o} value={o} />)}</datalist>
          </Field>
        </div>
      </FormSection>

      <FormSection title="日時">
        <div className="two-col">
          <Field label="開始日" required><input type="date" value={f.date || ''} onChange={(e) => field('date', e.target.value)} /></Field>
          <Field label="終了日" hint="複数日にわたる場合のみ"><input type="date" value={f.endDate || ''} min={f.date} onChange={(e) => field('endDate', e.target.value)} /></Field>
        </div>
        <div className="two-col">
          <Field label="開始時刻" required={!timeLocked}><input type="time" value={f.startTime || ''} disabled={timeLocked} onChange={(e) => { field('startTime', e.target.value); field('rawTime', '') }} /></Field>
          <Field label="終了時刻"><input type="time" value={f.endTime || ''} disabled={timeLocked} onChange={(e) => { field('endTime', e.target.value); field('rawTime', '') }} /></Field>
        </div>
        {f.rawTime && !f.startTime && !timeLocked && <div className="notice"><Info />現在の時間表記「{f.rawTime}」はそのまま保存されます。時刻を入力すると置き換わります。</div>}
        <label className="check"><input type="checkbox" checked={!!f.timeUndecided} onChange={(e) => { field('timeUndecided', e.target.checked); if (e.target.checked) field('allDay', false) }} />時刻未定</label>
        <label className="check"><input type="checkbox" checked={!!f.allDay} onChange={(e) => { field('allDay', e.target.checked); if (e.target.checked) field('timeUndecided', false) }} />終日</label>
        {!editing && (
          <Field label="追加日程" hint="同じ内容で別の日にも開催する場合。日付ごとに別IDで登録されます">
            <div className="inline-input">
              <input type="date" value={extraInput} onChange={(e) => setExtraInput(e.target.value)} />
              <button type="button" className="secondary" onClick={() => { if (extraInput && extraInput !== f.date && !(f.extraDates || []).includes(extraInput)) field('extraDates', [...(f.extraDates || []), extraInput].sort()); setExtraInput('') }}><Plus />追加</button>
            </div>
            {!!f.extraDates?.length && <div className="chips extra-dates">{f.extraDates.map((d) => <button type="button" key={d} className="badge" onClick={() => field('extraDates', f.extraDates!.filter((x) => x !== d))}>{d} <X /></button>)}</div>}
          </Field>
        )}
      </FormSection>

      <FormSection title="会場">
        <Field label="開催方法" required>
          <div className="segmented">{(['現地', 'オンライン', 'ハイブリッド'] as LocationMethod[]).map((x) => <button type="button" key={x} className={f.locationMethod === x ? 'selected' : ''} onClick={() => field('locationMethod', x)}>{x}</button>)}</div>
        </Field>
        {f.locationMethod !== 'オンライン' ? (
          <>
            <Field label="会場名" required>
              <input value={f.location} onChange={(e) => onLocationChange(e.target.value)} placeholder="会場名" list="location-list" />
              <datalist id="location-list">{Object.keys(meta?.locations || {}).map((l) => <option key={l} value={l} />)}</datalist>
            </Field>
            <div className="two-col">
              <Field label="都道府県"><select value={f.prefecture || ''} onChange={(e) => field('prefecture', e.target.value)}><option value="">選択してください</option>{prefectures.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="住所" hint="位置の取得に使います（シートには保存されません）"><input value={f.address || ''} onChange={(e) => field('address', e.target.value)} placeholder="住所" /></Field>
            </div>
            <GeoPicker f={f} field={field} />
          </>
        ) : (
          <div className="notice"><Info />オンライン開催は地図に表示されません。会場は「オンライン」として登録されます。</div>
        )}
      </FormSection>

      <FormSection title="詳細">
        <div className="two-col">
          <Field label="定員"><input value={f.capacity || ''} onChange={(e) => field('capacity', e.target.value)} placeholder="未定 / 定員なし / 数値" /></Field>
          <Field label="登壇者"><input value={f.speaker || ''} onChange={(e) => field('speaker', e.target.value)} placeholder="任意" /></Field>
        </div>
        <Field label="詳細説明"><textarea maxLength={10000} rows={6} value={f.description || ''} onChange={(e) => field('description', e.target.value)} /><small className="counter">{(f.description || '').length} / 10,000文字</small></Field>
        <Field label="詳細・申込URL" hint="utm_ などの計測用パラメータは保存時に自動で取り除きます"><input value={f.link || ''} onChange={(e) => field('link', e.target.value)} placeholder="https://example.com/" /></Field>
      </FormSection>

      <FormSection title="掲載設定">
        <label className="switch-row"><span>パートナーイベント</span><input type="checkbox" checked={f.isPartner} onChange={(e) => field('isPartner', e.target.checked)} /></label>
        <label className="switch-row"><span>おすすめイベント</span><input type="checkbox" checked={f.isRecommend} onChange={(e) => field('isRecommend', e.target.checked)} /></label>
      </FormSection>
    </>
  )
}

function GeoPicker({ f, field }: { f: EventItem; field: (k: string, v: unknown) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<{ lat: number; lng: number; address: string; pref: string }[]>([])
  const lat = parseFloat(f.lat || ''), lng = parseFloat(f.lng || '')
  const hasPos = isFinite(lat) && isFinite(lng)

  const apply = (g: { lat: number; lng: number; pref: string }) => {
    field('lat', String(g.lat))
    field('lng', String(g.lng))
    if (!f.prefecture && g.pref) field('prefecture', g.pref)
    setResults([])
  }
  const lookup = async () => {
    const q = (f.address || '').trim() || f.location.trim()
    setError('')
    setResults([])
    if (!q) { setError('住所または会場名を入力してください'); return }
    setBusy(true)
    try {
      const r = await api<{ results: { lat: number; lng: number; address: string; pref: string }[] }>('geocode', { address: q })
      if (r.results.length === 1) apply(r.results[0])
      else setResults(r.results)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const d = 0.004
  const mapSrc = hasPos ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}` : ''

  return (
    <div className="geo">
      <div className="geo-head">
        <button type="button" className="secondary" onClick={lookup} disabled={busy}>{busy ? <Loader2 className="spin" /> : <MapPin />}位置を取得</button>
        <span className="muted">住所（空欄なら会場名）から緯度・経度を取得します。地図のピンを確認してください。</span>
      </div>
      {error && <div className="error"><AlertTriangle />{error}</div>}
      {results.length > 1 && (
        <ul className="geo-results">{results.map((g) => <li key={`${g.lat},${g.lng}`}><button type="button" onClick={() => apply(g)}><MapPin />{g.address}</button></li>)}</ul>
      )}
      {hasPos
        ? <iframe className="map-frame" title="位置の確認" src={mapSrc} loading="lazy" />
        : <div className="map-mock"><MapPin /><span>位置が未設定です<br /><small>「位置を取得」を押すか、緯度・経度を入力してください（地図にピンを立てるため必須）</small></span></div>}
      <div className="two-col">
        <Field label="緯度 (lat)" required><input inputMode="decimal" value={f.lat || ''} onChange={(e) => field('lat', e.target.value.trim())} placeholder="35.6905" /></Field>
        <Field label="経度 (lng)" required><input inputMode="decimal" value={f.lng || ''} onChange={(e) => field('lng', e.target.value.trim())} placeholder="139.7502" /></Field>
      </div>
      {hasPos && <a className="link-btn small" href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noreferrer">Google マップで確認 <ExternalLink /></a>}
    </div>
  )
}

function LaunchForm({ f, field }: { f: LaunchItem; field: (k: string, v: unknown) => void }) {
  return (
    <FormSection title="打ち上げ情報">
      <Field label="打ち上げタイトル" required><input value={f.title} onChange={(e) => field('title', e.target.value)} placeholder="例：H3ロケット11号機 打ち上げ" /></Field>
      <div className="two-col">
        <Field label="打ち上げ予定日" required><input type="date" value={f.date || ''} onChange={(e) => field('date', e.target.value)} /></Field>
        <Field label="打ち上げ予定時刻"><input type="time" disabled={f.timeUndecided} value={f.time || ''} onChange={(e) => field('time', e.target.value.replace(/^0(\d):/, '$1:'))} /></Field>
      </div>
      <div className="notice"><Info />日付が決まっていない打ち上げはサイトのカレンダーに表示できないため、予定日が決まってから登録してください。</div>
      <label className="check"><input type="checkbox" checked={!!f.timeUndecided} onChange={(e) => field('timeUndecided', e.target.checked)} />時刻未定</label>
      <Field label="射場・打ち上げ場所">
        <input value={f.location} onChange={(e) => field('location', e.target.value)} placeholder="射場名" />
        <div className="quick-options">{launchSites.map((s) => <button type="button" key={s} onClick={() => field('location', s)}>{s}</button>)}</div>
      </Field>
      <Field label="ロケット名・号機"><input value={f.rocket} onChange={(e) => field('rocket', e.target.value)} placeholder="例：H3 11号機" /></Field>
      <Field label="詳細説明"><textarea rows={6} value={f.description || ''} onChange={(e) => field('description', e.target.value)} /></Field>
      <Field label="公式情報・配信URL"><input value={f.link || ''} onChange={(e) => field('link', e.target.value)} placeholder="https://www.jaxa.jp/..." /></Field>
    </FormSection>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="form-section"><h2>{title}</h2>{children}</section>
}
function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}{required && <em>必須</em>}</span>{children}{hint && <small className="hint">{hint}</small>}</label>
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 確認・詳細・完了・サイト反映
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function reviewRows(item: Item): [string, string][] {
  if (isEventItem(item)) {
    const dates = [item.date, ...(item.extraDates || [])]
    return [
      ['イベント名', item.title],
      ['開催日', item.endDate && item.endDate !== item.date ? `${item.date} 〜 ${item.endDate}` : dates.join('、')],
      ['時間', formatTime(item)],
      ['開催方法', item.locationMethod],
      ['会場', item.locationMethod === 'オンライン' ? 'オンライン' : item.location],
      ['都道府県', item.prefecture || (item.locationMethod === 'オンライン' ? 'オンライン' : '')],
      ['緯度・経度', item.lat && item.lng ? `${item.lat}, ${item.lng}` : ''],
      ['形式', item.types.join('、')],
      ['対象レベル', item.difficulty],
      ['主催団体', item.organizer],
      ['登壇者', item.speaker || ''],
      ['定員', item.capacity || ''],
      ['詳細・申込URL', item.link || ''],
      ['掲載設定', [item.isPartner && 'パートナー', item.isRecommend && 'おすすめ'].filter(Boolean).join('、')],
      ['詳細説明', item.description || ''],
    ]
  }
  return [
    ['打ち上げタイトル', item.title],
    ['予定日', item.date || ''],
    ['予定時刻', item.timeUndecided ? '未定' : item.time || ''],
    ['射場', item.location],
    ['ロケット', item.rocket],
    ['公式情報URL', item.link || ''],
    ['詳細説明', item.description || ''],
  ]
}

function ReviewView(p: {
  isEvent: boolean; form: Item; original: Item | null; editing: boolean; saving: boolean; duplicates: Duplicate[] | null
  onBack: () => void; onSave: (force?: boolean) => void; error: string
}) {
  const rows = reviewRows(p.form)
  const before = p.original ? Object.fromEntries(reviewRows(p.original)) : null
  const changed = before ? rows.filter(([k, v]) => (before[k] || '') !== (v || '')) : []
  return (
    <section className="content narrow">
      <div className="page-head"><div>
        <button className="back" onClick={p.onBack}><ChevronLeft />入力に戻る</button>
        <p className="eyebrow">{p.editing ? '変更内容確認' : '登録内容確認'}</p>
        <h1>{p.editing ? '変更内容を確認' : 'この内容で登録しますか？'}</h1>
        <p className="muted">任意の空欄は「未入力」と表示しています。{p.isEvent && !p.editing && (p.form as EventItem).extraDates?.length ? `${1 + (p.form as EventItem).extraDates!.length}件のイベントとして登録されます。` : ''}</p>
      </div></div>
      {p.editing && (
        <div className="diff">
          <strong>変更内容</strong>
          {changed.length ? (
            <ul>{changed.map(([k, v]) => <li key={k}><b>{k}</b>：<span className="old">{(before![k] || '未入力').slice(0, 80)}</span> → <span className="new">{(v || '未入力').slice(0, 80)}</span></li>)}</ul>
          ) : <p>変更はありません。</p>}
        </div>
      )}
      <div className="review-card">
        <h2>{p.form.title}</h2>
        {rows.slice(1).map(([k, v]) => <ReviewRow key={k} label={k} value={v || '未入力'} />)}
      </div>
      {p.duplicates && (
        <div className="error dup">
          <AlertTriangle />
          <div>
            <strong>同じ日付・タイトルの情報がすでに登録されています</strong>
            <ul>{p.duplicates.map((d) => <li key={d.id}>{p.isEvent ? `ID ${d.id}` : `行 ${d.id}`}：{d.date} {d.time || ''} {d.title}</li>)}</ul>
            <button className="secondary" onClick={() => p.onSave(true)} disabled={p.saving}>重複を承知で登録する</button>
          </div>
        </div>
      )}
      {p.error && <div className="error"><AlertTriangle />{p.error}</div>}
      <div className="form-footer">
        <button className="secondary" onClick={p.onBack}>修正する</button>
        <button className="primary" onClick={() => p.onSave(false)} disabled={p.saving || (p.editing && !changed.length)}>
          {p.saving ? <><Loader2 className="spin" />保存中…</> : <>{p.editing ? '変更を反映' : 'この内容で登録'} <Check /></>}
        </button>
      </div>
    </section>
  )
}
function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="review-row"><span>{label}</span><strong>{value}</strong></div>
}

function DetailView({ item, isEvent, onBack, onEdit, onCopy, onArchive }: { item: Item; isEvent: boolean; onBack: () => void; onEdit: () => void; onCopy: () => void; onArchive: (reason: string) => Promise<void> }) {
  const [archiving, setArchiving] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // イベントは編集用の内容（rev）を読み込むまで非公開操作をさせない
  const ready = !isEventItem(item) || !!item.rev
  const doArchive = async () => {
    setBusy(true)
    setError('')
    try { await onArchive(reason.trim()) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <section className="content narrow">
      <div className="page-head">
        <div>
          <button className="back" onClick={onBack}><ChevronLeft />一覧へ戻る</button>
          <p className="eyebrow">詳細</p>
          <h1>{item.title}</h1>
          <p className="muted">{isEvent ? `ID ${item.id}` : `ロケット打上シート ${item.id} 行目`}{isEventItem(item) && item.updatedAt ? ` · 更新 ${item.updatedAt}` : ''}</p>
        </div>
        <div className="head-actions"><button className="secondary" onClick={onCopy}><Copy />複製</button><button className="primary" onClick={onEdit}><Pencil />編集</button></div>
      </div>
      <div className="detail-card">
        <div className="detail-date"><CalendarDays /><DateText item={item} /></div>
        {reviewRows(item).slice(1).filter(([k]) => !['開催日', '時間', '予定日', '予定時刻'].includes(k)).map(([k, v]) => <DetailBlock key={k} label={k} value={v || '未入力'} />)}
        {isEventItem(item) && <a className="external" href={siteEventUrl(item.id)} target="_blank" rel="noreferrer">cbed.fsif.jp で見る <ExternalLink /></a>}
        {item.link && <a className="external" href={item.link} target="_blank" rel="noreferrer">公式・申込URLを開く <ExternalLink /></a>}
      </div>
      <div className="detail-card danger-zone">
        <h2 className="card-title">サイトから外す</h2>
        {!archiving ? (
          <>
            <p className="muted">中止になったイベントや誤登録を非公開にします。行は「{isEvent ? '非公開' : 'ロケット打上（非公開）'}」シートに移り、一覧の「非公開」からいつでも元に戻せます。</p>
            <button className="secondary danger" onClick={() => setArchiving(true)} disabled={!ready}><EyeOff />非公開にする</button>
          </>
        ) : (
          <>
            <Field label="理由（任意）"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：中止・延期、重複登録、誤登録" maxLength={200} /></Field>
            {error && <div className="error"><AlertTriangle />{error}</div>}
            <div className="complete-actions left">
              <button className="secondary" onClick={() => setArchiving(false)} disabled={busy}>やめる</button>
              <button className="primary danger" onClick={doArchive} disabled={busy}>{busy ? <Loader2 className="spin" /> : <EyeOff />}非公開にする</button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
function DetailBlock({ label, value }: { label: string; value: string }) {
  return <div className="detail-block"><span>{label}</span><p>{value}</p></div>
}

function CompleteView({ result, onNew, onList, onBuild }: { result: SaveResult; onNew: () => void; onList: () => void; onBuild: () => void }) {
  return (
    <section className="content narrow complete">
      <div className="complete-icon"><Check /></div>
      <p className="eyebrow">完了</p>
      <h1>{result.editing ? '変更をスプレッドシートに保存しました' : 'スプレッドシートに登録しました'}</h1>
      <p className="muted">{result.title}{result.isEvent ? `（ID ${result.ids.join(', ')}）` : ''}</p>
      {result.build?.at && <div className="notice"><Info />{result.build.at} ごろに cbed.fsif.jp の自動ビルドが始まり、数分後にサイトへ反映されます。</div>}
      {result.build && !result.build.scheduled && <div className="error"><AlertTriangle />{result.build.error || '自動ビルドを予約できませんでした。「サイト反映」から手動でビルドしてください。'}</div>}
      {result.isEvent && (
        <ul className="page-links">{result.ids.map((id) => <li key={id}><a href={siteEventUrl(id)} target="_blank" rel="noreferrer">{siteEventUrl(id)} <ExternalLink /></a></li>)}</ul>
      )}
      <div className="complete-actions">
        <button className="primary" onClick={onNew}>続けて登録</button>
        <button className="secondary" onClick={onList}>一覧へ戻る</button>
        <button className="link-btn" onClick={onBuild}>反映状況を見る</button>
      </div>
    </section>
  )
}

const STATUS_LABEL: Record<string, string> = { success: '成功', failure: '失敗', cancelled: 'キャンセル', in_progress: 'ビルド中', queued: '待機中', pending: '待機中', waiting: '待機中', skipped: 'スキップ' }
const EVENT_LABEL: Record<string, string> = { workflow_dispatch: '管理画面', push: 'コード更新', schedule: '定期実行' }

function BuildView({ pendingBuildAt, setPendingBuildAt, fastBuild }: { pendingBuildAt: string; setPendingBuildAt: (s: string) => void; fastBuild: boolean }) {
  const [runs, setRuns] = useState<BuildRun[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const r = await api<{ runs: BuildRun[]; pendingBuildAt: string }>('buildStatus')
      setRuns(r.runs)
      setPendingBuildAt(r.pendingBuildAt || '')
    } catch (e) {
      setError((e as Error).message)
      setRuns([])
    }
  }, [setPendingBuildAt])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!runs?.some((r) => r.status !== 'completed')) return
    const t = setTimeout(load, 15000)
    return () => clearTimeout(t)
  }, [runs, load])

  const buildNow = async () => {
    setBusy(true)
    setError('')
    try {
      await api('build')
      setConfirming(false)
      setPendingBuildAt('')
      setTimeout(load, 4000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="content narrow">
      <div className="page-head"><div>
        <p className="eyebrow">BUILD / サイト反映</p>
        <h1>cbed.fsif.jp への反映</h1>
        <p className="muted">サイトは GitHub Actions でスプレッドシートを読み込んでビルドし、イベントごとの個別ページを作っています。登録・編集・非公開にすると、{fastBuild ? '約1分後' : '公開CSVが更新されるのを待って約10分後'}に自動でビルドされます（続けて操作した場合はまとめて1回）。</p>
      </div><div className="head-actions"><button className="secondary" onClick={load}><RefreshCw />状況を更新</button></div></div>
      {pendingBuildAt && <div className="notice"><Info />{pendingBuildAt} ごろに自動ビルドが始まります。</div>}
      <div className="detail-card">
        <h2 className="card-title">最近のビルド</h2>
        {!runs ? <p className="muted"><Loader2 className="spin" /> 読み込み中…</p> : runs.length ? (
          <ul className="runs">{runs.map((r) => {
            const key = r.status === 'completed' ? r.conclusion || '' : r.status
            return <li key={r.id}><span className={`run-status ${key}`}>{STATUS_LABEL[key] || key}</span><span>{new Date(r.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</span><span className="muted">{EVENT_LABEL[r.event] || r.event}</span><a className="link-btn" href={r.url} target="_blank" rel="noreferrer">詳細 <ExternalLink /></a></li>
          })}</ul>
        ) : <p className="muted">ビルド履歴はありません</p>}
        <a className="external" href={ACTIONS_URL} target="_blank" rel="noreferrer">GitHub Actions を開く <ExternalLink /></a>
      </div>
      {error && <div className="error"><AlertTriangle />{error}</div>}
      <div className="detail-card">
        <h2 className="card-title">今すぐビルド</h2>
        <p className="muted">スプレッドシートを直接編集したときなどに使います。{fastBuild ? 'ビルドはスプレッドシートの最新の内容を読み込みます。' : '公開CSVへの反映には約5分かかるため、編集直後だと新しい内容が反映されないことがあります。'}</p>
        {confirming
          ? <div className="complete-actions left"><button className="secondary" onClick={() => setConfirming(false)}>やめる</button><button className="primary" onClick={buildNow} disabled={busy}>{busy ? <Loader2 className="spin" /> : <UploadCloud />}ビルドを開始する</button></div>
          : <button className="primary" onClick={() => setConfirming(true)}><UploadCloud />今すぐビルド</button>}
      </div>
    </section>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 非公開にした情報
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
type ArchivedRow = { id: string; title: string; date: string; sub: string; archivedAt: string; archivedBy: string; reason: string }

function ArchivedList({ isEvent, onChanged }: { isEvent: boolean; onChanged: (build?: BuildInfo) => void }) {
  const [rows, setRows] = useState<ArchivedRow[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [confirmPurge, setConfirmPurge] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      if (isEvent) {
        const r = await api<{ events: (SheetEvent & { archivedAt: string; archivedBy: string; archiveReason: string })[] }>('archiveList')
        setRows(r.events.map((e) => ({ id: String(e.id), title: e.title, date: e.date, sub: [e.location, e.organizer].filter(Boolean).join(' / '), archivedAt: e.archivedAt, archivedBy: e.archivedBy, reason: e.archiveReason })))
      } else {
        const r = await api<{ launches: Record<string, string>[] }>('launchArchiveList')
        setRows(r.launches.map((l) => ({ id: l.id, title: l.title, date: l.date, sub: [l.rocket, l.location].filter(Boolean).join(' / '), archivedAt: l['非公開日時'] || '', archivedBy: l['非公開にした人'] || '', reason: l['理由'] || '' })))
      }
    } catch (e) {
      setError((e as Error).message)
      setRows([])
    }
  }, [isEvent])
  useEffect(() => { load() }, [load])

  const act = async (row: ArchivedRow, kind: 'restore' | 'purge') => {
    setBusyId(row.id)
    setError('')
    setMessage('')
    try {
      const action = isEvent ? kind : kind === 'restore' ? 'launchRestore' : 'launchPurge'
      const r = await api<{ build?: BuildInfo }>(action, isEvent ? { id: row.id } : { id: row.id, expectedTitle: row.title })
      if (kind === 'restore') { onChanged(r.build); setMessage(`「${row.title}」を公開中に戻しました。サイトの反映後に表示されます。`) }
      else setMessage(`「${row.title}」を完全に削除しました。`)
      setConfirmPurge('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId('')
    }
  }

  return (
    <>
      <p className="muted small-note">非公開にした{isEvent ? 'イベント' : '打ち上げ情報'}はサイトに表示されません。「公開に戻す」で元のシートの末尾に戻ります{isEvent ? '（IDはそのまま）' : ''}。</p>
      {message && <div className="notice"><Check />{message}</div>}
      {error && <div className="error"><AlertTriangle />{error}</div>}
      {!rows ? <div className="empty"><Loader2 className="spin" /><h3>読み込み中…</h3></div> : rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{isEvent ? 'イベント名' : 'タイトル'}</th><th>日付</th><th>非公開にした日・人</th><th>理由</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="static-row">
                  <td><strong>{r.title}</strong><small>{isEvent ? `ID ${r.id}` : r.sub}{isEvent && r.sub ? ` · ${r.sub}` : ''}</small></td>
                  <td>{r.date}</td>
                  <td>{r.archivedAt}<small>{r.archivedBy}</small></td>
                  <td>{r.reason || <span className="muted">—</span>}</td>
                  <td>
                    {confirmPurge === r.id ? (
                      <div className="row-confirm">
                        <span>元に戻せません。削除しますか？</span>
                        <button className="secondary" onClick={() => setConfirmPurge('')}>やめる</button>
                        <button className="primary danger" onClick={() => act(r, 'purge')} disabled={busyId === r.id}>削除する</button>
                      </div>
                    ) : (
                      <div className="row-actions">
                        <button title="公開に戻す" onClick={() => act(r, 'restore')} disabled={!!busyId}>{busyId === r.id ? <Loader2 className="spin" /> : <RotateCcw />}</button>
                        <button title="完全に削除" onClick={() => setConfirmPurge(r.id)} disabled={!!busyId}><Trash2 /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty"><EyeOff /><h3>非公開にした{isEvent ? 'イベント' : '打ち上げ情報'}はありません</h3><p>詳細画面の「非公開にする」でサイトから外せます。</p></div>}
    </>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// データ点検
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
type Issue = { id: string; title: string; date: string; endDate: string; row: number; level: 'error' | 'warn'; code: string; message: string }
type Broken = { id: string; title: string; date: string; url: string; status: number }

const ISSUE_LABEL: Record<string, string> = {
  id: 'ID', 'id-dup': 'IDの重複', title: 'イベント名', date: '日付', time: '時間', location: '会場', latlng: '緯度・経度',
  type: 'イベント形式', difficulty: '対象レベル', pref: '都道府県', link: 'リンク', dup: '重複の可能性',
}

function AuditView({ onEdit }: { onEdit: (id: string) => void }) {
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [upcoming, setUpcoming] = useState(true)
  const [level, setLevel] = useState<'' | 'error' | 'warn'>('')
  const [code, setCode] = useState('')
  const [links, setLinks] = useState<{ running: boolean; checked: number; total: number; broken: Broken[]; done: boolean } | null>(null)
  const today = todayJst()

  const load = useCallback(async () => {
    setError('')
    setIssues(null)
    try {
      const r = await api<{ issues: Issue[]; total: number }>('audit')
      setIssues(r.issues)
      setTotal(r.total)
    } catch (e) {
      setError((e as Error).message)
      setIssues([])
    }
  }, [])
  useEffect(() => { load() }, [load])

  const scoped = useMemo(() => (issues || []).filter((i) => !upcoming || (i.endDate || i.date || '9999') >= today), [issues, upcoming, today])
  const shown = scoped.filter((i) => (!level || i.level === level) && (!code || i.code === code))
  const counts = scoped.reduce<Record<string, number>>((m, i) => { m[i.code] = (m[i.code] || 0) + 1; return m }, {})
  const errors = scoped.filter((i) => i.level === 'error').length

  const runLinkCheck = async () => {
    let state = { running: true, checked: 0, total: 0, broken: [] as Broken[], done: false }
    setLinks(state)
    try {
      while (!state.done) {
        const r = await api<{ checked: number; total: number; done: boolean; broken: Broken[] }>('linkCheck', { offset: state.checked, limit: 40 })
        state = { running: !r.done, checked: r.checked, total: r.total, broken: [...state.broken, ...r.broken], done: r.done }
        setLinks(state)
      }
    } catch (e) {
      setError((e as Error).message)
      setLinks({ ...state, running: false })
    }
  }

  return (
    <section className="content">
      <div className="page-head">
        <div>
          <p className="eyebrow">AUDIT / データ点検</p>
          <h1>データ点検</h1>
          <p className="muted">スプレッドシート（シート1）の全{total ? ` ${total} ` : ''}件を点検し、サイトで正しく表示されない行や確認した方がよい行を一覧にします。</p>
        </div>
        <div className="head-actions"><button className="secondary" onClick={load}><RefreshCw />もう一度点検</button></div>
      </div>
      {error && <div className="error"><AlertTriangle />{error}</div>}

      <div className="audit-summary">
        <div className={`audit-stat${errors ? ' bad' : ' good'}`}><b>{issues ? errors : '…'}</b><span>要修正</span><small>サイトで正しく表示されない</small></div>
        <div className="audit-stat"><b>{issues ? scoped.length - errors : '…'}</b><span>要確認</span><small>直した方がよい</small></div>
        <div className="audit-codes">
          {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
            <button key={c} className={code === c ? 'chip-selected' : ''} onClick={() => setCode(code === c ? '' : c)}>{ISSUE_LABEL[c] || c} {n}</button>
          ))}
        </div>
      </div>

      <div className="toolbar">
        <label className="check"><input type="checkbox" checked={upcoming} onChange={(e) => setUpcoming(e.target.checked)} />開催前のイベントだけ</label>
        <label className="sort">重要度<select value={level} onChange={(e) => setLevel(e.target.value as '' | 'error' | 'warn')}><option value="">すべて</option><option value="error">要修正</option><option value="warn">要確認</option></select></label>
      </div>

      <div className="list-meta"><span>{issues ? `${shown.length}件` : '点検中…'}</span><span>行をクリックすると編集できます</span></div>
      {!issues ? (
        <div className="empty"><Loader2 className="spin" /><h3>点検中…</h3><p>件数が多いと数秒かかります。</p></div>
      ) : shown.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>重要度</th><th>イベント名</th><th>開催日</th><th>内容</th><th></th></tr></thead>
            <tbody>
              {shown.map((i, n) => (
                <tr key={`${i.row}-${i.code}-${n}`} onClick={() => i.id && onEdit(i.id)}>
                  <td><Badge tone={i.level === 'error' ? 'amber' : 'neutral'}>{i.level === 'error' ? '要修正' : '要確認'}</Badge></td>
                  <td><strong>{i.title || '（タイトルなし）'}</strong><small>{i.id ? `ID ${i.id}` : ''} · {i.row} 行目</small></td>
                  <td>{i.date}</td>
                  <td>{i.message}</td>
                  <td><div className="row-actions">{i.id && <button title="編集" onClick={(e) => { e.stopPropagation(); onEdit(i.id) }}><Pencil /></button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty"><Check /><h3>問題は見つかりませんでした</h3><p>{upcoming ? '「開催前のイベントだけ」を外すと過去のイベントも点検できます。' : ''}</p></div>
      )}

      <div className="detail-card link-check">
        <h2 className="card-title"><Link2Off /> 申込リンクの確認</h2>
        <p className="muted">開催前のイベントの申込・詳細リンクに実際にアクセスし、ページが存在しない（404 など）ものを探します。件数によって1〜数分かかります。</p>
        {links && (
          <p className="muted">{links.running ? <><Loader2 className="spin" /> 確認中… </> : null}{links.checked} / {links.total} 件のリンクを確認{links.done ? ` · 切れているリンク ${links.broken.length} 件` : ''}</p>
        )}
        {!!links?.broken.length && (
          <ul className="broken-links">
            {links.broken.map((b) => (
              <li key={`${b.id}-${b.url}`}>
                <button className="link-btn" onClick={() => onEdit(b.id)}><Pencil />ID {b.id}</button>
                <span>{b.date} {b.title}</span>
                <a href={b.url} target="_blank" rel="noreferrer">{b.status ? `HTTP ${b.status}` : '接続できません'} <ExternalLink /></a>
              </li>
            ))}
          </ul>
        )}
        <button className="secondary" onClick={runLinkCheck} disabled={!!links?.running}>{links?.running ? <Loader2 className="spin" /> : <Link2Off />}{links ? 'もう一度確認' : 'リンクを確認する'}</button>
      </div>
    </section>
  )
}

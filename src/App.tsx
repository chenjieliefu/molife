import {
  ArrowLeft,
  ArrowRight,
  Buildings,
  Check,
  CheckCircle,
  Clock,
  Confetti,
  Copy,
  Crown,
  DoorOpen,
  FileText,
  GearSix,
  HandSwipeLeft,
  Heart,
  HouseLine,
  MapTrifold,
  Microphone,
  PencilSimple,
  Play,
  QrCode,
  Scan,
  SealCheck,
  Sparkle,
  TextT,
  Ticket as TicketIcon,
  Train,
  UploadSimple,
  UserPlus,
  UsersThree,
  X,
} from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChangeEvent, useEffect, useRef, useState } from 'react'
import type { GeneratedSummaryDto, JourneyDto, LobbyDto, SessionDto, StationDto, TicketDto } from './shared/contracts'
import { MolifeApiError, MolifeClient } from './lib/api'
import { ticketOverlapsScanner } from './lib/checkin'
import { clearMembership, isValidInviteCode, normalizeInviteCode, readMembership, saveMembership, StationMembership, StationRole } from './lib/station'
import { WorkSummary } from './lib/summary'
import { formatCountdown, readableDate, secondsUntil } from './lib/time'

type Screen = 'onboarding' | 'station' | 'input' | 'loading' | 'summary' | 'ticket-loading' | 'ticket' | 'checkin' | 'lobby' | 'departure' | 'journey'
type InputMode = 'text' | 'voice' | 'file'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

const HERO = '/assets/molife-hero-character-cream.png'
const LINEUP = '/assets/molife-coworker-lineup-cream.png'
const LIFE = '/assets/molife-life-panorama.png'

const DEFAULT_SUMMARY: WorkSummary = {
  completed: '',
  progress: '',
  tomorrow: '',
}

function App() {
  const reduceMotion = useReducedMotion()
  const storedMembership = readMembership()
  const [membership, setMembership] = useState<StationMembership | null>(storedMembership)
  const [client] = useState(() => new MolifeClient(storedMembership?.token))
  const [screen, setScreen] = useState<Screen>(() => membership ? 'station' : 'onboarding')
  const [stationName, setStationName] = useState(() => membership?.stationName || localStorage.getItem('molife-station') || '设计站')
  const [departureTime, setDepartureTime] = useState(() => membership?.departureTime || localStorage.getItem('molife-time') || '18:30')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inputMode, setInputMode] = useState<InputMode>('text')
  const [draft, setDraft] = useState('')
  const [summary, setSummary] = useState<WorkSummary>(DEFAULT_SUMMARY)
  const [summaryMeta, setSummaryMeta] = useState<Pick<GeneratedSummaryDto, 'provider' | 'warning'>>({ provider: 'local' })
  const [ticket, setTicket] = useState<TicketDto | null>(null)
  const [lobby, setLobby] = useState<LobbyDto | null>(null)
  const [journey, setJourney] = useState<JourneyDto | null>(null)
  const [actionError, setActionError] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState('')
  const [seconds, setSeconds] = useState(() => secondsUntil(departureTime))
  const [checkedIn, setCheckedIn] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(secondsUntil(departureTime)), 1000)
    return () => window.clearInterval(timer)
  }, [departureTime])

  useEffect(() => {
    if (!storedMembership?.token) return
    client.getSession().then(acceptSession).catch((error) => {
      if (error instanceof MolifeApiError && error.status === 401) switchStation()
    })
  // Session restoration intentionally runs only once for the stored token.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if ((screen === 'lobby' || screen === 'departure') && !checkedIn) setScreen('checkin')
  }, [screen, checkedIn])

  useEffect(() => {
    if (screen !== 'lobby' || !membership) return
    const refresh = () => client.getLobby().then(setLobby).catch(() => undefined)
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [client, membership, screen])

  useEffect(() => {
    if (!membership) return
    const refreshStation = () => client.getSession().then((session) => {
      if (session.station.name !== stationName || session.station.departureTime !== departureTime) acceptSession(session)
    }).catch(() => undefined)
    const timer = window.setInterval(refreshStation, 15000)
    return () => window.clearInterval(timer)
  }, [client, membership, stationName, departureTime])

  const messageFor = (error: unknown) => error instanceof Error ? error.message : '服务暂时没有回应，请稍后再试。'

  const issueTicket = async (summaryId?: string) => {
    setActionError('')
    setScreen('ticket-loading')
    try {
      const issued = await client.issueTicket(summaryId)
      setTicket(issued)
      setCheckedIn(Boolean(issued.checkedInAt))
      setScreen('ticket')
    } catch (error) {
      setActionError(messageFor(error))
      setScreen(summaryId ? 'summary' : 'station')
    }
  }

  const runSummary = async () => {
    setIsRecording(false)
    setActionError('')
    setScreen('loading')
    try {
      const generated = await client.generateSummary(draft)
      setSummary({ completed: generated.completed, progress: generated.progress, tomorrow: generated.tomorrow })
      setSummaryMeta({ provider: generated.provider, warning: generated.warning })
      setScreen('summary')
    } catch (error) {
      setActionError(messageFor(error))
      setScreen('input')
    }
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileError('')
    if (!/\.(txt|md)$/i.test(file.name)) {
      setFileName('')
      setFileError('暂时只支持 TXT 和 MD 文件，但你仍然可以直接领票。')
      return
    }
    if (file.size > 50 * 1024) {
      setFileName('')
      setFileError('文件请控制在 50KB 以内，也可以直接粘贴重点。')
      return
    }
    const content = await file.text()
    if (content.length > 10_000) {
      setFileName('')
      setFileError('内容请控制在 10,000 字以内，方便 AI 抓住重点。')
      return
    }
    setFileName(file.name)
    setDraft(content)
  }

  const saveSettings = async () => {
    if (!membership) return
    setActionError('')
    try {
      const station = await client.updateStation({ name: stationName, departureTime })
      const updated = { ...membership, stationName, departureTime }
      updated.stationName = station.name
      updated.departureTime = station.departureTime
      saveMembership(updated)
      setMembership(updated)
      setStationName(station.name)
      setDepartureTime(station.departureTime)
      setSeconds(secondsUntil(station.departureTime))
      setSettingsOpen(false)
    } catch (error) {
      setActionError(messageFor(error))
    }
  }

  const acceptSession = (session: SessionDto): StationMembership => {
    const nextMembership: StationMembership = {
      token: session.token,
      stationId: session.station.id,
      memberId: session.member.id,
      stationName: session.station.name,
      departureTime: session.station.departureTime,
      stationCode: session.station.code,
      nickname: session.member.nickname,
      role: session.member.role,
    }
    client.setToken(session.token)
    saveMembership(nextMembership)
    setMembership(nextMembership)
    setStationName(nextMembership.stationName)
    setDepartureTime(nextMembership.departureTime)
    setSeconds(secondsUntil(nextMembership.departureTime))
    return nextMembership
  }

  const enterStation = () => setScreen('station')

  const switchStation = () => {
    clearMembership()
    client.setToken('')
    setMembership(null)
    setSettingsOpen(false)
    setInviteOpen(false)
    setTicket(null)
    setLobby(null)
    setScreen('onboarding')
  }

  const saveSummaryAndTicket = async () => {
    setActionError('')
    try {
      const saved = await client.saveSummary({ sourceText: draft, ...summary, ...summaryMeta })
      await issueTicket(saved.id)
    } catch (error) {
      setActionError(messageFor(error))
    }
  }

  const handleCheckIn = async () => {
    if (!ticket) throw new Error('请先领取今天的车票。')
    const checkedTicket = await client.checkIn(ticket.id)
    setTicket(checkedTicket)
    setCheckedIn(true)
  }

  const enterLobby = async () => {
    setActionError('')
    try {
      setLobby(await client.getLobby())
      setScreen('lobby')
    } catch (error) {
      setActionError(messageFor(error))
    }
  }

  const previewDeparture = async () => {
    setActionError('')
    if (lobby?.departed) {
      setScreen('departure')
      return
    }
    try {
      setLobby(await client.previewDraw())
      setScreen('departure')
    } catch (error) {
      setActionError(messageFor(error))
    }
  }

  const openJourney = async () => {
    setScreen('journey')
    try {
      setJourney(await client.getJourney())
    } catch (error) {
      setActionError(messageFor(error))
    }
  }

  const transition = reduceMotion ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <main className="page-shell">
      <aside className="brand-panel" aria-hidden="true">
        <div className="brand-lockup"><Logo /> <span>Molife</span></div>
        <div className="brand-copy">
          <p className="eyebrow light">MORE LIFE AFTER WORK</p>
          <h1>今天的工作<br />到站了。</h1>
          <p>把下班变成一件大家都敢做的小事。</p>
        </div>
        <img src={LIFE} alt="" />
      </aside>

      <div className="app-frame">
        <header className="app-header">
          <button className="brand-button" onClick={() => setScreen(membership ? 'station' : 'onboarding')} aria-label={membership ? '回到今日站台' : '回到欢迎页'}>
            <Logo /> <span>Molife</span>
          </button>
          {membership && screen !== 'onboarding' && (
            <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="站台设置">
              <GearSix size={22} weight="bold" />
            </button>
          )}
        </header>

        <div className="screen-viewport">
          <AnimatePresence mode="wait">
            <motion.section
              key={screen}
              className={`screen screen-${screen}`}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
              transition={transition}
            >
              {screen === 'onboarding' && (
                <OnboardingScreen
                  membership={membership}
                  onCreate={async (input) => acceptSession(await client.createStation(input))}
                  onLookup={(code) => client.lookupStation(code)}
                  onJoin={async (input) => acceptSession(await client.joinStation(input))}
                  onEnter={enterStation}
                />
              )}

              {actionError && screen !== 'onboarding' && <p className="error-message global-error" role="alert">{actionError}</p>}

              {screen === 'station' && (
                <StationScreen
                  stationName={stationName}
                  departureTime={departureTime}
                  seconds={seconds}
                  onDirect={() => issueTicket()}
                  onSummary={() => setScreen('input')}
                />
              )}

              {screen === 'input' && (
                <InputScreen
                  mode={inputMode}
                  setMode={setInputMode}
                  draft={draft}
                  setDraft={setDraft}
                  isRecording={isRecording}
                  setIsRecording={setIsRecording}
                  fileName={fileName}
                  fileError={fileError}
                  onFile={handleFile}
                  onBack={() => setScreen('station')}
                  onDirect={() => issueTicket()}
                  onSummarize={runSummary}
                />
              )}

              {screen === 'loading' && <LoadingScreen onDirect={() => issueTicket()} />}

              {screen === 'ticket-loading' && <TicketLoadingScreen />}

              {screen === 'summary' && (
                <SummaryScreen
                  summary={summary}
                  setSummary={setSummary}
                  onBack={() => setScreen('input')}
                  warning={summaryMeta.warning}
                  onSaveTicket={saveSummaryAndTicket}
                  onTicketOnly={() => issueTicket()}
                />
              )}

              {screen === 'ticket' && (
                <TicketScreen
                  ticket={ticket}
                  onCheckIn={() => setScreen('checkin')}
                />
              )}

              {screen === 'checkin' && (
                <CheckInScreen
                  ticket={ticket}
                  checkedIn={checkedIn}
                  onBack={() => setScreen('ticket')}
                  onCheck={handleCheckIn}
                  onChecked={enterLobby}
                />
              )}

              {screen === 'lobby' && (
                <LobbyScreen
                  departureTime={departureTime}
                  seconds={seconds}
                  lobby={lobby}
                  onBack={() => setScreen('checkin')}
                  onDeparture={previewDeparture}
                />
              )}

              {screen === 'departure' && (
                <DepartureScreen lobby={lobby} memberId={membership?.memberId || ''} onJourney={openJourney} />
              )}

              {screen === 'journey' && (
                <JourneyScreen departureTime={departureTime} journey={journey} onToday={() => setScreen('station')} />
              )}
            </motion.section>
          </AnimatePresence>
        </div>

        {!['onboarding', 'input', 'loading', 'summary', 'ticket-loading', 'checkin'].includes(screen) && (
          <nav className="bottom-nav" aria-label="主导航">
            <button className={screen !== 'journey' ? 'active' : ''} onClick={() => setScreen('station')}>
              <HouseLine size={21} weight={screen !== 'journey' ? 'fill' : 'regular'} />
              今日站台
            </button>
            <button className={screen === 'journey' ? 'active' : ''} onClick={openJourney}>
              <MapTrifold size={21} weight={screen === 'journey' ? 'fill' : 'regular'} />
              我的旅程
            </button>
          </nav>
        )}
      </div>

      <AnimatePresence>
        {settingsOpen && (
          <SettingsPanel
            stationName={stationName}
            setStationName={setStationName}
            departureTime={departureTime}
            setDepartureTime={setDepartureTime}
            stationCode={membership?.stationCode || ''}
            nickname={membership?.nickname || ''}
            role={membership?.role || 'member'}
            onClose={() => setSettingsOpen(false)}
            onSave={saveSettings}
            onInvite={() => {
              setSettingsOpen(false)
              setInviteOpen(true)
            }}
            onSwitch={switchStation}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {inviteOpen && membership && (
          <InvitePanel membership={membership} onClose={() => setInviteOpen(false)} />
        )}
      </AnimatePresence>
    </main>
  )
}

function Logo() {
  return <span className="logo-mark"><Train size={19} weight="fill" /></span>
}

type OnboardingView = 'welcome' | 'create' | 'join' | 'invite'

function OnboardingScreen({ membership, onCreate, onLookup, onJoin, onEnter }: {
  membership: StationMembership | null
  onCreate: (input: { name: string; departureTime: string; nickname: string; timezone?: string }) => Promise<StationMembership>
  onLookup: (code: string) => Promise<StationDto>
  onJoin: (input: { code: string; nickname: string }) => Promise<StationMembership>
  onEnter: () => void
}) {
  const reduceMotion = useReducedMotion()
  const [view, setView] = useState<OnboardingView>('welcome')
  const [createName, setCreateName] = useState('设计站')
  const [createTime, setCreateTime] = useState('18:30')
  const [nickname, setNickname] = useState('小莫')
  const [joinCode, setJoinCode] = useState('')
  const [joinFound, setJoinFound] = useState<StationDto | null>(null)
  const [joinError, setJoinError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
  }, [])

  const createStation = async () => {
    setIsSubmitting(true)
    setJoinError('')
    try {
      await onCreate({ name: createName.trim(), departureTime: createTime, nickname: nickname.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      setView('invite')
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : '车站创建失败，请稍后再试。')
    } finally {
      setIsSubmitting(false)
    }
  }

  const findStation = async () => {
    const normalized = normalizeInviteCode(joinCode)
    setJoinCode(normalized)
    if (!isValidInviteCode(normalized)) {
      setJoinFound(null)
      setJoinError('请输入 6 位邀请码。')
      return
    }
    setIsSubmitting(true)
    setJoinError('')
    try {
      setJoinFound(await onLookup(normalized))
    } catch (error) {
      setJoinFound(null)
      setJoinError(error instanceof Error ? error.message : '没有找到这个车站。')
    } finally {
      setIsSubmitting(false)
    }
  }

  const joinStation = async () => {
    setIsSubmitting(true)
    setJoinError('')
    try {
      await onJoin({ code: joinCode, nickname: nickname.trim() })
      onEnter()
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : '加入失败，请稍后再试。')
    } finally {
      setIsSubmitting(false)
    }
  }

  const enterDemo = async () => {
    setIsSubmitting(true)
    try {
      await onCreate({ name: '体验站', departureTime: '18:30', nickname: '小莫', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      onEnter()
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : '体验站创建失败，请稍后再试。')
    } finally {
      setIsSubmitting(false)
    }
  }

  const copyInvite = async () => {
    if (!membership) return
    try {
      await navigator.clipboard.writeText(membership.stationCode)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopyState('idle'), 1800)
  }

  if (view === 'welcome') {
    return (
      <div className="onboarding-welcome">
        <div className="onboarding-art">
          <img src={LINEUP} alt="拿着车票、准备加入同一个车站的可爱同事们" />
        </div>
        <div className="onboarding-copy">
          <p className="eyebrow">一起准点下班</p>
          <h2>先找到一起<br />下班的人。</h2>
          <p>车站把认识的同事聚在一起。你们会看到相同的倒计时、候车厅和抽选结果。</p>
        </div>
        <div className="onboarding-actions">
          <button className="primary-button" onClick={() => setView('create')}>
            <Buildings size={20} weight="fill" /> 创建车站 <ArrowRight size={18} weight="bold" />
          </button>
          <button className="secondary-button" onClick={() => setView('join')}>
            <UserPlus size={20} weight="bold" /> 用邀请码加入
          </button>
          <button className="text-button" onClick={enterDemo} disabled={isSubmitting}>先自己体验一下</button>
          {joinError && <p className="error-message inline-error" role="alert">{joinError}</p>}
        </div>
      </div>
    )
  }

  if (view === 'create') {
    return (
      <>
        <ScreenHeader title="创建一个车站" note="你会成为站长，负责设置大家的发车时间。" onBack={() => setView('welcome')} />
        <div className="station-form-illustration">
          <span><Crown size={23} weight="fill" /></span>
          <div><strong>站长负责发车时间</strong><small>工作总结依然只属于每个人自己。</small></div>
        </div>
        <div className="station-form">
          <label className="field-label compact"><span>车站名称</span><input value={createName} maxLength={12} onChange={(event) => setCreateName(event.target.value)} /></label>
          <label className="field-label compact"><span>约定下班时间</span><input type="time" value={createTime} onInput={(event) => setCreateTime(event.currentTarget.value)} onChange={(event) => setCreateTime(event.target.value)} /></label>
          <label className="field-label compact"><span>你的昵称</span><input value={nickname} maxLength={8} onChange={(event) => setNickname(event.target.value)} /></label>
        </div>
        {joinError && <p className="error-message inline-error" role="alert">{joinError}</p>}
        <button className="primary-button full-width" onClick={createStation} disabled={isSubmitting || !createName.trim() || !createTime || !nickname.trim()}>
          {isSubmitting ? '正在创建…' : '创建并邀请同事'} <ArrowRight size={18} weight="bold" />
        </button>
      </>
    )
  }

  if (view === 'join') {
    return (
      <>
        <ScreenHeader title="加入同事的车站" note="向创建车站的同事要一个 6 位邀请码。" onBack={() => setView('welcome')} />
        <div className="join-visual"><QrCode size={44} weight="duotone" /><span>一张邀请码，只通往一个车站</span></div>
        <div className="station-form join-form">
          <label className="field-label compact">
            <span>车站邀请码</span>
            <input className="invite-input" value={joinCode} placeholder="例如 LIFE88" inputMode="text" autoCapitalize="characters" aria-invalid={Boolean(joinError)} aria-describedby="invite-code-help invite-code-error" onChange={(event) => {
              setJoinCode(normalizeInviteCode(event.target.value))
              setJoinFound(null)
              setJoinError('')
            }} />
            <small id="invite-code-help">邀请码由站长创建车站后生成</small>
          </label>
          <label className="field-label compact"><span>你的昵称</span><input value={nickname} maxLength={8} onChange={(event) => setNickname(event.target.value)} /></label>
          {joinError && <p id="invite-code-error" className="error-message inline-error" role="alert">{joinError}</p>}
        </div>
        {!joinFound ? (
          <button className="primary-button full-width" onClick={findStation} disabled={isSubmitting || !joinCode || !nickname.trim()}>
            {isSubmitting ? '正在查找…' : '查找车站'} <Scan size={19} weight="bold" />
          </button>
        ) : (
          <motion.div className="found-station" role="status" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .28 }}>
            <div className="found-station-route"><span>公司</span><Train size={22} weight="fill" /><span>生活</span></div>
            <div><small>找到车站</small><strong>{joinFound.name}</strong><span>{joinFound.departureTime} 发车，已有 {joinFound.memberCount} 位同事</span></div>
            <button className="primary-button" onClick={joinStation} disabled={isSubmitting}>{isSubmitting ? '正在加入…' : '加入这个车站'} <ArrowRight size={18} weight="bold" /></button>
          </motion.div>
        )}
      </>
    )
  }

  return (
    <div className="invite-screen">
      <div className="invite-success"><CheckCircle size={34} weight="fill" /></div>
      <p className="eyebrow">车站创建成功</p>
      <h2>把同事们<br />叫上车吧。</h2>
      <p>把邀请码发给认识的同事，他们就会进入同一个候车厅。</p>
      <div className="invite-ticket">
        <div className="invite-ticket-main">
          <small>{membership?.stationName}</small>
          <strong>{membership?.stationCode}</strong>
          <span>{membership?.departureTime} 准点发车</span>
        </div>
        <div className="invite-qr"><QrCode size={48} weight="duotone" /></div>
      </div>
      <button className="secondary-button" onClick={copyInvite}>
        {copyState === 'copied' ? <Check size={19} weight="bold" /> : <Copy size={19} weight="bold" />}
        {copyState === 'copied' ? '邀请码已复制' : copyState === 'failed' ? '复制失败，请手动记录' : '复制邀请码'}
      </button>
      <button className="primary-button full-width" onClick={onEnter}>进入我的站台 <ArrowRight size={18} weight="bold" /></button>
      <p className="prototype-note">邀请码已经生效。同事加入后，会进入同一个候车厅并共享抽选结果。</p>
    </div>
  )
}

function StationScreen({ stationName, departureTime, seconds, onDirect, onSummary }: {
  stationName: string
  departureTime: string
  seconds: number
  onDirect: () => void
  onSummary: () => void
}) {
  return (
    <>
      <div className="station-intro">
        <div>
          <p className="eyebrow">{readableDate()}</p>
          <h2>嗨，今天也<br />辛苦啦。</h2>
          <p>下一班生活号将在 <strong>{departureTime}</strong> 发车</p>
        </div>
        <img className="hero-character" src={HERO} alt="一个开心挥手、拿着车票的可爱角色" />
      </div>

      <div className="station-board">
        <div className="station-board-top">
          <span><span className="live-dot" /> {stationName}</span>
          <span>{formatCountdown(seconds)}</span>
        </div>
        <div className="route-line">
          <span className="route-stop active" />
          <span className="route-track"><Train size={19} weight="fill" /></span>
          <span className="route-stop" />
        </div>
        <div className="route-labels"><span>公司</span><span>生活</span></div>
      </div>

      <div className="choice-heading">
        <span>今天怎么上车？</span>
        <small>两种方式，机会完全一样</small>
      </div>
      <div className="choice-grid">
        <button className="choice-card direct" onClick={onDirect}>
          <span className="choice-icon"><TicketIcon size={27} weight="fill" /></span>
          <span><strong>直接领票</strong><small>今天不想总结也没关系</small></span>
          <ArrowRight size={19} weight="bold" />
        </button>
        <button className="choice-card summary" onClick={onSummary}>
          <span className="choice-icon"><Sparkle size={27} weight="fill" /></span>
          <span><strong>留下今天</strong><small>让 AI 帮你整理工作留痕</small></span>
          <ArrowRight size={19} weight="bold" />
        </button>
      </div>
      <p className="kind-note"><Heart size={15} weight="fill" /> 下班时间是大家的约定，不是离开的许可。</p>
    </>
  )
}

function ScreenHeader({ title, onBack, note }: { title: string; onBack: () => void; note?: string }) {
  return (
    <div className="screen-header">
      <button className="icon-button" onClick={onBack} aria-label="返回"><ArrowLeft size={21} weight="bold" /></button>
      <div><h2>{title}</h2>{note && <p>{note}</p>}</div>
    </div>
  )
}

function InputScreen({ mode, setMode, draft, setDraft, isRecording, setIsRecording, fileName, fileError, onFile, onBack, onDirect, onSummarize }: {
  mode: InputMode
  setMode: (mode: InputMode) => void
  draft: string
  setDraft: (value: string) => void
  isRecording: boolean
  setIsRecording: (value: boolean) => void
  fileName: string
  fileError: string
  onFile: (event: ChangeEvent<HTMLInputElement>) => void
  onBack: () => void
  onDirect: () => void
  onSummarize: () => void
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [voiceError, setVoiceError] = useState('')

  useEffect(() => () => recognitionRef.current?.abort(), [])

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop()
      return
    }
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor
      webkitSpeechRecognition?: SpeechRecognitionConstructor
    }
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Recognition) {
      setVoiceError('当前浏览器不支持语音转文字，可以使用文字或文件输入。')
      return
    }
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results, (result) => result[0]?.transcript || '').join('')
      if (transcript) setDraft(`${draft} ${transcript}`.trim())
    }
    recognition.onerror = () => {
      setVoiceError('没有听清，检查麦克风权限后再试一次。')
      setIsRecording(false)
    }
    recognition.onend = () => setIsRecording(false)
    recognitionRef.current = recognition
    setVoiceError('')
    setIsRecording(true)
    recognition.start()
  }

  return (
    <>
      <ScreenHeader title="留下今天" note="说多少都可以，AI 会帮你收好重点。" onBack={onBack} />
      <div className="segmented" role="tablist" aria-label="输入方式">
        {([
          ['text', TextT, '文字'],
          ['voice', Microphone, '语音'],
          ['file', FileText, '文件'],
        ] as const).map(([value, Icon, label]) => (
          <button key={value} role="tab" aria-selected={mode === value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>
            <Icon size={18} weight="bold" /> {label}
          </button>
        ))}
      </div>

      <div className="input-card">
        {mode === 'text' && (
          <label className="field-label">
            <span>今天做了什么？</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={'例如：\n完成了首页方案，和同事确认了插画方向。\n明天准备开始移动端适配。'}
              autoFocus
            />
            <small>{draft.length} 字，不用写成周报</small>
          </label>
        )}

        {mode === 'voice' && (
          <div className="voice-panel">
            <p>{isRecording ? '正在听，你慢慢说' : draft ? '已经记下来了' : '点一下，随便说说今天'}</p>
            <div className={`waveform ${isRecording ? 'recording' : ''}`} aria-hidden="true">
              {Array.from({ length: 15 }).map((_, index) => <i key={index} style={{ animationDelay: `${index * 0.05}s` }} />)}
            </div>
            <button
              className={`record-button ${isRecording ? 'active' : ''}`}
              onClick={toggleRecording}
              aria-label={isRecording ? '停止录音' : '开始录音'}
            >
              {isRecording ? <X size={25} weight="bold" /> : <Microphone size={28} weight="fill" />}
            </button>
            <small>{isRecording ? '点击结束录音' : draft ? '可再次录制' : '首次使用需要允许麦克风权限'}</small>
            {voiceError && <p className="error-message" role="alert">{voiceError}</p>}
          </div>
        )}

        {mode === 'file' && (
          <div className="file-panel">
            <input id="work-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onFile} />
            <label htmlFor="work-file" className="drop-zone">
              <span className="choice-icon"><UploadSimple size={27} weight="bold" /></span>
              <strong>{fileName || '选择 TXT 或 MD 文件'}</strong>
              <small>{fileName ? '文件内容已读取，可以交给 AI 整理' : '最大 50KB，支持 10,000 字以内'}</small>
            </label>
            {fileError && <p className="error-message">{fileError}</p>}
          </div>
        )}
      </div>

      <div className="action-stack">
        <button className="primary-button" onClick={onSummarize} disabled={!draft.trim()}>
          <Sparkle size={20} weight="fill" /> 让 AI 帮我整理 <ArrowRight size={18} weight="bold" />
        </button>
        <button className="text-button" onClick={onDirect}>不总结，直接领票</button>
      </div>
    </>
  )
}

function LoadingScreen({ onDirect }: { onDirect: () => void }) {
  return (
    <div className="loading-screen">
      <div className="loading-orbit"><Sparkle size={34} weight="fill" /><i /><i /><i /></div>
      <p className="eyebrow">AI 正在整理</p>
      <h2>把忙碌，折成<br />几句清楚的话。</h2>
      <p>只保留重点，不会把你写成一台工作机器。</p>
      <button className="text-button" onClick={onDirect}>不等了，直接领票</button>
    </div>
  )
}

function TicketLoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-orbit"><TicketIcon size={34} weight="fill" /><i /><i /><i /></div>
      <p className="eyebrow">正在出票</p>
      <h2>下一站，<br />是你的生活。</h2>
      <p>正在为你安排今天的生活号座位。</p>
    </div>
  )
}

function SummaryScreen({ summary, setSummary, onBack, warning, onSaveTicket, onTicketOnly }: {
  summary: WorkSummary
  setSummary: (summary: WorkSummary) => void
  onBack: () => void
  warning?: string
  onSaveTicket: () => void
  onTicketOnly: () => void
}) {
  const fields: Array<[keyof WorkSummary, string, string]> = [
    ['completed', '今天完成', '✓'],
    ['progress', '正在推进', '↗'],
    ['tomorrow', '明天再做', '○'],
  ]
  return (
    <>
      <ScreenHeader title="今天，收好了" note="这是草稿，随时可以改。" onBack={onBack} />
      <div className="summary-paper">
        <div className="paper-heading">
          <span><SealCheck size={22} weight="fill" /> 今日工作留痕</span>
          <span>{readableDate()}</span>
        </div>
        {fields.map(([key, label, symbol]) => (
          <label key={key} className="summary-field">
            <span className="summary-symbol">{symbol}</span>
            <span className="summary-content">
              <strong>{label}</strong>
              <textarea value={summary[key]} onChange={(event) => setSummary({ ...summary, [key]: event.target.value })} />
            </span>
            <PencilSimple size={17} />
          </label>
        ))}
        <div className="privacy-note"><Check size={16} weight="bold" /> 只有点击“保存并领票”才会保存这份总结</div>
        {warning && <p className="prototype-note">{warning}</p>}
      </div>
      <div className="action-stack">
        <button className="primary-button" onClick={onSaveTicket}><TicketIcon size={20} weight="fill" /> 保存并领票 <ArrowRight size={18} weight="bold" /></button>
        <button className="text-button" onClick={onTicketOnly}>只领票，不保存总结</button>
      </div>
    </>
  )
}

function TicketCard({ ticket, compact = false }: { ticket: TicketDto; compact?: boolean }) {
  return (
    <article className={`ticket-card ${compact ? 'compact' : ''}`}>
      <div className="ticket-visual">
        <img src={LIFE} alt="下班后的公园、晚餐、宠物和音乐生活" draggable={false} />
        <div className="ticket-brand"><Logo /> MOLIFE</div>
        <div className="ticket-route"><strong>公司</strong><ArrowRight size={18} weight="bold" /><strong>生活</strong></div>
      </div>
      <div className="ticket-stub">
        <div><small>发车</small><strong>{ticket.departureTime}</strong></div>
        <div><small>站台</small><strong>{ticket.stationName}</strong></div>
        <div><small>座位</small><strong>{ticket.seat}</strong></div>
        <div className="barcode" aria-hidden="true" />
      </div>
    </article>
  )
}

function TicketScreen({ ticket, onCheckIn }: { ticket: TicketDto | null; onCheckIn: () => void }) {
  if (!ticket) return <TicketLoadingScreen />
  return (
    <div className="ticket-screen-inner">
      <div className="celebration-badge"><Confetti size={20} weight="fill" /> 车票已生成</div>
      <h2>你的生活号车票<br />已经到手。</h2>
      <p>无论有没有总结，每一张票的机会都一样。</p>
      <TicketCard ticket={ticket} />
      <div className="ticket-rule">
        <UsersThree size={22} weight="fill" />
        <span><strong>发车前随机选出 2 至 3 位领队</strong><small>领队先站起来，大家一起准点下班</small></span>
      </div>
      <button className="primary-button" onClick={onCheckIn}>拿票去检票 <Scan size={19} weight="bold" /></button>
    </div>
  )
}

function CheckInScreen({ ticket, checkedIn, onBack, onCheck, onChecked }: {
  ticket: TicketDto | null
  checkedIn: boolean
  onBack: () => void
  onCheck: () => Promise<void>
  onChecked: () => void
}) {
  const reduceMotion = useReducedMotion()
  const dragAreaRef = useRef<HTMLDivElement>(null)
  const scannerRef = useRef<HTMLDivElement>(null)
  const ticketRef = useRef<HTMLDivElement>(null)
  const nextButtonRef = useRef<HTMLButtonElement>(null)
  const [status, setStatus] = useState<'ready' | 'missed' | 'checking' | 'checked'>(() => checkedIn ? 'checked' : 'ready')
  const [checkError, setCheckError] = useState('')

  useEffect(() => {
    if (status === 'checked') nextButtonRef.current?.focus()
  }, [status])

  const checkTicket = async () => {
    if (status === 'checked' || status === 'checking') return
    setStatus('checking')
    setCheckError('')
    try {
      await onCheck()
      setStatus('checked')
    } catch (error) {
      setStatus('missed')
      setCheckError(error instanceof Error ? error.message : '检票失败，请再试一次。')
    }
  }

  if (!ticket) return <TicketLoadingScreen />

  return (
    <div className="checkin-screen-inner">
      <ScreenHeader title="车票请准备好" note="把车票拖进上方检票口。" onBack={onBack} />
      <div className={`checkin-stage ${status}`} ref={dragAreaRef}>
        <div className="scanner-wrap">
          <motion.div
            ref={scannerRef}
            className="ticket-scanner"
            animate={reduceMotion ? {} : status === 'missed' ? { x: [-5, 5, -3, 0] } : status === 'checked' ? { scale: [1, 1.04, 1] } : {}}
            transition={{ duration: reduceMotion ? 0 : 0.32 }}
          >
            <div className="scanner-display">
              {status === 'checked' ? <CheckCircle size={27} weight="fill" /> : <Scan size={25} weight="duotone" />}
              <span>{status === 'checked' ? '检票成功' : status === 'checking' ? '正在验票' : '生活号检票口'}</span>
            </div>
            <div className="scanner-slot"><i /></div>
          </motion.div>
        </div>

        <div className="drag-hint" aria-live="polite">
          {status === 'ready' && (reduceMotion ? <>点击下方按钮完成检票</> : <><HandSwipeLeft size={18} weight="bold" /> 按住车票，向上拖进检票口</>)}
          {status === 'missed' && <>还差一点，再靠近检票口试试</>}
          {status === 'checking' && <>正在核对今天的生活号车票…</>}
          {status === 'checked' && <>欢迎上车，候车厅里的同事正在等你</>}
        </div>

        <div className="draggable-ticket-space">
          <AnimatePresence mode="wait">
            {status !== 'checked' ? (
              <motion.div
                key="ticket"
                ref={ticketRef}
                className="draggable-ticket"
                role="button"
                tabIndex={0}
                aria-label="生活号车票。拖到检票口，或按回车键完成检票。"
                drag={!reduceMotion && status !== 'checking'}
                dragConstraints={dragAreaRef}
                dragElastic={0.16}
                dragSnapToOrigin
                whileDrag={{ scale: 1.035, rotate: -2, zIndex: 5 }}
                onDragStart={() => setStatus('ready')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    checkTicket()
                  }
                }}
                onDragEnd={(_, info) => {
                  const target = scannerRef.current?.getBoundingClientRect()
                  const ticket = ticketRef.current?.getBoundingClientRect()
                  if (!target || !ticket) return
                  const movedIntoGate = info.offset.y < -125 && Math.abs(info.offset.x) < 160
                  if (ticketOverlapsScanner(ticket, target) || movedIntoGate) checkTicket()
                  else setStatus('missed')
                }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -105, scale: 0.55, rotate: -4 }}
                transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 24 }}
              >
                <TicketCard ticket={ticket} compact />
              </motion.div>
            ) : (
              <motion.div key="success" className="checkin-success" initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }}>
                <span><Check size={26} weight="bold" /></span>
                <strong>今天也要准点生活</strong>
                <small>车票已经盖上今日检票章</small>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {checkError && <p className="error-message inline-error" role="alert">{checkError}</p>}

      {status !== 'checked' ? (
        <button className="text-button checkin-fallback" onClick={checkTicket} disabled={status === 'checking'}>{status === 'checking' ? '正在检票…' : '拖动不方便？点击这里检票'}</button>
      ) : (
        <button ref={nextButtonRef} className="primary-button full-width" onClick={onChecked}>进入候车大厅 <ArrowRight size={18} weight="bold" /></button>
      )}
    </div>
  )
}

function LobbyScreen({ departureTime, seconds, lobby, onBack, onDeparture }: { departureTime: string; seconds: number; lobby: LobbyDto | null; onBack: () => void; onDeparture: () => void }) {
  return (
    <>
      <ScreenHeader title="生活号候车厅" note={`今天 ${departureTime} 准点发车`} onBack={onBack} />
      <div className="countdown-card">
        <span className="countdown-label"><Clock size={17} weight="fill" /> 距离发车</span>
        <strong>{formatCountdown(seconds)}</strong>
        <div className="countdown-track"><i style={{ width: '68%' }} /></div>
      </div>
      <div className="lobby-scene">
        <img src={LINEUP} alt="八位拿着车票、准备一起下班的可爱同事" />
        <span className="scene-label"><span className="live-dot" /> 已有 {lobby?.checkedInCount ?? 0} 人上车</span>
      </div>
      <div className="fair-card">
        <span className="choice-icon"><UsersThree size={24} weight="fill" /></span>
        <span><strong>每个人，机会都一样</strong><small>系统会随机选出 2 至 3 位下班领队</small></span>
        <SealCheck size={20} weight="fill" />
      </div>
      <div className="prototype-card">
        <span><strong>{lobby?.departed ? '生活号已经发车' : '想先看看发车时刻？'}</strong><small>{lobby?.departed ? '查看今天正式保存的领队结果。' : '预演结果固定，不会写入正式抽选。'}</small></span>
        <button onClick={onDeparture}><Play size={17} weight="fill" /> {lobby?.departed ? '查看' : '体验'}</button>
      </div>
    </>
  )
}

function DepartureScreen({ lobby, memberId, onJourney }: { lobby: LobbyDto | null; memberId: string; onJourney: () => void }) {
  const isLeader = Boolean(lobby?.leaders.some((leader) => leader.id === memberId))
  const leaderNames = lobby?.leaders.map((leader) => leader.id === memberId ? '你' : leader.nickname).join('、') || '今天的领队'
  return (
    <div className="departure-screen-inner">
      <div className="departure-hero">
        <img src={LIFE} alt="夕阳下从公司走向生活的轻松场景" />
        <div className="departure-overlay">
          <p className="eyebrow light">生活号准点发车</p>
          <h2>{isLeader ? '今天，换你先站起来。' : '有人先站起来了。'}</h2>
        </div>
      </div>
      <div className={`leader-card ${isLeader ? 'selected' : ''}`}>
        <span className="leader-avatar">{isLeader ? '你' : '夏'}</span>
        <span>
          <small>{isLeader ? '你被选为今天的下班领队' : `${leaderNames}被选为领队`}</small>
          <strong>{isLeader ? '不用不好意思，带大家走吧。' : '跟上他们，今天一起准点走。'}</strong>
        </span>
        <Sparkle size={22} weight="fill" />
      </div>
      <div className="departure-copy">
        <h3>工作留在今天，<br />生活现在开始。</h3>
        <p>关电脑，拿好东西。没有人需要独自成为第一个离开的人。</p>
      </div>
      <button className="primary-button pulse-button" onClick={onJourney}>
        一起下班 <ArrowRight size={19} weight="bold" />
      </button>
    </div>
  )
}

function JourneyScreen({ departureTime, journey, onToday }: { departureTime: string; journey: JourneyDto | null; onToday: () => void }) {
  const memories = [
    ['公园吹风', '18:48', 'park'],
    ['好好吃饭', '19:12', 'dinner'],
    ['回家撸猫', '19:46', 'pet'],
    ['听点音乐', '20:30', 'music'],
  ]
  return (
    <>
      <div className="journey-heading">
        <div><p className="eyebrow">MY MORE LIFE</p><h2>我的生活旅程</h2></div>
        <span className="journey-stat"><strong>{journey?.totalOnTimeDepartures ?? 0}</strong><small>次准点下班</small></span>
      </div>
      <div className="journey-banner">
        <img src={LIFE} alt="下班后属于自己的生活片段" />
        <div><small>本周收回</small><strong>3 小时 20 分</strong><span>留给自己的时间</span></div>
      </div>
      <div className="section-title"><span>最近的生活片段</span><small>不必打卡，只是纪念</small></div>
      <div className="memory-grid">
        {memories.map(([title, time, position]) => (
          <article className={`memory-card ${position}`} key={title}>
            <div className="memory-image" style={{ backgroundImage: `url(${LIFE})` }} />
            <span><strong>{title}</strong><small>{time}</small></span>
          </article>
        ))}
      </div>
      <div className="past-ticket">
        <span><TicketIcon size={22} weight="fill" /></span>
        <div><small>{journey?.tickets[0]?.workDate || '今天'}的生活号</small><strong>{journey?.tickets[0]?.departureTime || departureTime} · 公司 → 生活</strong></div>
        <Check size={19} weight="bold" />
      </div>
      <button className="secondary-button" onClick={onToday}>回到今日站台</button>
    </>
  )
}

function SettingsPanel({ stationName, setStationName, departureTime, setDepartureTime, stationCode, nickname, role, onClose, onSave, onInvite, onSwitch }: {
  stationName: string
  setStationName: (value: string) => void
  departureTime: string
  setDepartureTime: (value: string) => void
  stationCode: string
  nickname: string
  role: StationRole
  onClose: () => void
  onSave: () => void
  onInvite: () => void
  onSwitch: () => void
}) {
  const isOwner = role === 'owner'
  const reduceMotion = useReducedMotion()
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside className="settings-panel" initial={reduceMotion ? false : { y: '100%' }} animate={{ y: 0 }} exit={reduceMotion ? { opacity: 0 } : { y: '100%' }} transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 260 }} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }} aria-modal="true" role="dialog" aria-labelledby="settings-title">
        <div className="sheet-handle" />
        <div className="settings-heading"><div><p className="eyebrow">STATION SETTINGS</p><h2 id="settings-title">{isOwner ? '管理你的车站' : '我的车站'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭" autoFocus><X size={21} weight="bold" /></button></div>
        <div className="station-membership-card">
          <span className="member-avatar">{nickname.slice(0, 1)}</span>
          <div><small>{isOwner ? '你是本站站长' : '你已加入这个车站'}</small><strong>{stationName}</strong><span>邀请码 {stationCode}</span></div>
          {isOwner ? <Crown size={22} weight="fill" /> : <SealCheck size={22} weight="fill" />}
        </div>
        <label className="field-label compact"><span>车站名称</span><input value={stationName} maxLength={12} disabled={!isOwner} onChange={(event) => setStationName(event.target.value)} /></label>
        <label className="field-label compact"><span>约定下班时间</span><input type="time" value={departureTime} disabled={!isOwner} onInput={(event) => setDepartureTime(event.currentTarget.value)} onChange={(event) => setDepartureTime(event.target.value)} /></label>
        <div className="settings-tip"><Clock size={19} weight="fill" /><span><strong>{isOwner ? '站长可以调整大家的发车时间' : '发车时间由站长统一设置'}</strong><small>这个时间只用于倒计时和组团提醒。</small></span></div>
        <div className="settings-actions">
          {isOwner && <button className="primary-button" onClick={onSave} disabled={!stationName.trim() || !departureTime}>保存设置 <Check size={19} weight="bold" /></button>}
          <button className="secondary-button" onClick={onInvite}><UserPlus size={19} weight="bold" /> 邀请同事</button>
          <button className="text-button" onClick={onSwitch}><DoorOpen size={18} weight="bold" /> 重新选择车站</button>
        </div>
      </motion.aside>
    </motion.div>
  )
}

function InvitePanel({ membership, onClose }: { membership: StationMembership; onClose: () => void }) {
  const reduceMotion = useReducedMotion()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
  }, [])
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(membership.stationCode)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopyState('idle'), 1800)
  }
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside className="settings-panel invite-panel" initial={reduceMotion ? false : { y: '100%' }} animate={{ y: 0 }} exit={reduceMotion ? { opacity: 0 } : { y: '100%' }} transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 260 }} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }} aria-modal="true" role="dialog" aria-labelledby="invite-title">
        <div className="sheet-handle" />
        <div className="settings-heading"><div><p className="eyebrow">INVITE COWORKERS</p><h2 id="invite-title">邀请同事上车</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭" autoFocus><X size={21} weight="bold" /></button></div>
        <div className="invite-ticket panel-ticket">
          <div className="invite-ticket-main"><small>{membership.stationName}</small><strong>{membership.stationCode}</strong><span>{membership.departureTime} 准点发车</span></div>
          <div className="invite-qr"><QrCode size={48} weight="duotone" /></div>
        </div>
        <p className="invite-explanation">同事输入邀请码后，就会与你进入相同的倒计时、候车厅和领队抽选。</p>
        <button className="primary-button full-width" onClick={copyInvite}>
          {copyState === 'copied' ? <Check size={19} weight="bold" /> : <Copy size={19} weight="bold" />}
          {copyState === 'copied' ? '邀请码已复制' : copyState === 'failed' ? '复制失败，请手动记录' : '复制邀请码'}
        </button>
      </motion.aside>
    </motion.div>
  )
}

export default App

import { useEffect, useMemo, useRef, useState } from 'react'

const ASSET_BASE = import.meta.env.BASE_URL

const DURATIONS = [
  { label: '3 min', value: '180000' },
  { label: '5 min', value: '300000' },
  { label: '10 min', value: '600000' },
  { label: '15 min', value: '900000' },
  { label: 'Personalizado', value: 'custom' }
]

const DEFAULT_DURATION = 300000
const DEFAULT_DURATION_MODE = '300000'
const SETTINGS_KEY = 'belga-timer-settings'
const HISTORY_KEY = 'belga-timer-history'

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY))
    const customMinutes = saved?.customMinutes || 7
    const durationMode = saved?.durationMode || String(saved?.durationMs || DEFAULT_DURATION)
    const durationMs = durationMode === 'custom'
      ? Math.max(60000, customMinutes * 60000)
      : Number(durationMode || DEFAULT_DURATION)

    return {
      durationMs: Number.isFinite(durationMs) ? durationMs : DEFAULT_DURATION,
      customMinutes,
      durationMode
    }
  } catch {
    return { durationMs: DEFAULT_DURATION, customMinutes: 7, durationMode: DEFAULT_DURATION_MODE }
  }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []
  } catch {
    return []
  }
}

function formatTime(ms, withTenths = false) {
  const safeMs = Math.max(0, ms)
  const minutes = Math.floor(safeMs / 60000)
  const seconds = Math.floor((safeMs % 60000) / 1000)
  const tenths = Math.floor((safeMs % 1000) / 100)
  const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return withTenths ? `${base}.${tenths}` : base
}

function vibrate(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern)
}

function playFinishBeep() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return

  const context = new AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(880, context.currentTime)
  gain.gain.setValueAtTime(0.001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.28, context.currentTime + 0.03)
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.45)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.48)
}

function StatCard({ label, value, accent = false }) {
  return (
    <div className={`rounded-lg border p-4 ${accent ? 'border-yellow-300/40 bg-yellow-300/10' : 'border-white/10 bg-white/[0.04]'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black ${accent ? 'text-yellow-200' : 'text-white'}`}>{value}</p>
    </div>
  )
}

export default function App() {
  const initialSettings = useMemo(loadSettings, [])
  const [durationMs, setDurationMs] = useState(initialSettings.durationMs)
  const [customMinutes, setCustomMinutes] = useState(initialSettings.customMinutes)
  const [durationMode, setDurationMode] = useState(initialSettings.durationMode)
  const [status, setStatus] = useState('idle')
  const [remainingMs, setRemainingMs] = useState(initialSettings.durationMs)
  const [sungMs, setSungMs] = useState(0)
  const [longestMs, setLongestMs] = useState(0)
  const [entries, setEntries] = useState(0)
  const [isSinging, setIsSinging] = useState(false)
  const [canaryName, setCanaryName] = useState('')
  const [history, setHistory] = useState(loadHistory)

  const durationRef = useRef(durationMs)
  const statusRef = useRef(status)
  const remainingRef = useRef(remainingMs)
  const sungRef = useRef(sungMs)
  const longestRef = useRef(longestMs)
  const entriesRef = useRef(entries)
  const singingRef = useRef(isSinging)
  const canaryNameRef = useRef(canaryName)
  const lastTickRef = useRef(null)
  const singingStartRef = useRef(null)
  const finishSavedRef = useRef(false)

  useEffect(() => {
    durationRef.current = durationMs
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ durationMs, customMinutes, durationMode }))
  }, [durationMs, customMinutes, durationMode])

  useEffect(() => {
    statusRef.current = status
    remainingRef.current = remainingMs
    sungRef.current = sungMs
    longestRef.current = longestMs
    entriesRef.current = entries
    singingRef.current = isSinging
    canaryNameRef.current = canaryName
  }, [status, remainingMs, sungMs, longestMs, entries, isSinging, canaryName])

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  }, [history])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (statusRef.current !== 'running') return

      const now = performance.now()
      const elapsed = now - lastTickRef.current
      lastTickRef.current = now

      setRemainingMs((current) => {
        const next = Math.max(0, current - elapsed)
        remainingRef.current = next
        if (next <= 0) finishTrial(now)
        return next
      })
    }, 100)

    return () => window.clearInterval(interval)
  }, [])

  const currentSungMs = status === 'running' && isSinging && singingStartRef.current
    ? sungMs + (performance.now() - singingStartRef.current)
    : sungMs
  const percent = durationMs ? Math.min(100, (currentSungMs / durationMs) * 100) : 0
  const oneMinuteWarning = status === 'running' && remainingMs <= 60000

  function startTrial() {
    if (status === 'finished') resetTrial()
    lastTickRef.current = performance.now()
    setStatus('running')
  }

  function pauseTrial() {
    if (status !== 'running') return
    const now = performance.now()
    if (singingRef.current) closeSingingSegment(now, true)
    setStatus('paused')
  }

  function resetTrial(nextDuration = durationRef.current) {
    setStatus('idle')
    setRemainingMs(nextDuration)
    setSungMs(0)
    setLongestMs(0)
    setEntries(0)
    setIsSinging(false)
    singingStartRef.current = null
    lastTickRef.current = null
    finishSavedRef.current = false
  }

  function closeSingingSegment(now, keepStopped = false) {
    if (!singingStartRef.current) return
    const segment = Math.max(0, now - singingStartRef.current)
    const nextSung = sungRef.current + segment
    const nextLongest = Math.max(longestRef.current, segment)

    sungRef.current = nextSung
    longestRef.current = nextLongest
    setSungMs(nextSung)
    setLongestMs(nextLongest)
    singingStartRef.current = null
    setIsSinging(false)
    if (!keepStopped) vibrate([70, 35, 70])
  }

  function toggleSinging() {
    if (status !== 'running') return
    const now = performance.now()

    if (singingRef.current) {
      closeSingingSegment(now)
      return
    }

    setEntries((current) => {
      const next = current + 1
      entriesRef.current = next
      return next
    })
    singingStartRef.current = now
    setIsSinging(true)
    vibrate(90)
  }

  function finishTrial(now = performance.now()) {
    if (finishSavedRef.current) return
    finishSavedRef.current = true
    if (singingRef.current) closeSingingSegment(now, true)

    const total = sungRef.current
    const result = {
      id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
      date: new Date().toISOString(),
      canaryName: canaryNameRef.current.trim(),
      durationMs: durationRef.current,
      sungMs: total,
      percent: durationRef.current ? (total / durationRef.current) * 100 : 0,
      longestMs: longestRef.current,
      entries: entriesRef.current
    }

    setRemainingMs(0)
    setStatus('finished')
    setHistory((current) => [result, ...current].slice(0, 30))
    playFinishBeep()
    vibrate([180, 80, 180])
  }

  function changeDuration(value) {
    setDurationMode(value)
    const next = value === 'custom' ? Math.max(60000, customMinutes * 60000) : Number(value)
    setDurationMs(next)
    if (status === 'idle' || status === 'finished') resetTrial(next)
  }

  function changeCustomMinutes(value) {
    const minutes = Math.max(1, Math.min(60, Number(value) || 1))
    setDurationMode('custom')
    setCustomMinutes(minutes)
    setDurationMs(minutes * 60000)
    if (status === 'idle' || status === 'finished') resetTrial(minutes * 60000)
  }

  const lastResult = history[0]

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#3b2f16_0,#111827_35%,#020617_78%)] px-4 py-5 text-slate-100 safe-bottom">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <header className="grid gap-4">
          <div className="overflow-hidden rounded-lg border border-yellow-300/25 bg-black shadow-glow">
            <img
              src={`${ASSET_BASE}logo.svg`}
              alt="Tropa dos Belgas"
              className="h-auto w-full"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src={`${ASSET_BASE}icon.svg`}
                alt=""
                className="h-14 w-14 shrink-0 rounded-lg border border-yellow-300/30 bg-slate-950 object-cover"
              />
              <div className="min-w-0">
                <h1 className="text-3xl font-black leading-none text-white">Tropa dos Belgas</h1>
                <p className="mt-1 text-sm text-slate-300">Cronometro de canto canario belga</p>
                <p className="text-xs font-black uppercase tracking-wide text-yellow-200">Tropa JF</p>
              </div>
            </div>
            <div className="rounded-lg border border-yellow-300/30 bg-yellow-300/10 px-3 py-2 text-center">
              <p className="text-xs font-bold uppercase text-yellow-200">Prova</p>
              <p className="text-sm font-black text-white">{formatTime(durationMs)}</p>
            </div>
          </div>
        </header>

        <section className={`rounded-lg border p-5 shadow-2xl ${oneMinuteWarning ? 'border-yellow-300 bg-yellow-300/12' : 'border-white/10 bg-slate-950/70'}`}>
          {oneMinuteWarning && (
            <div className="mb-4 rounded-md bg-yellow-300 px-3 py-2 text-center text-sm font-black uppercase text-slate-950">
              Atenção: falta 1 minuto
            </div>
          )}

          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-400">Tempo restante da prova</p>
            <p className="mt-2 font-mono text-7xl font-black leading-none text-white">{formatTime(remainingMs)}</p>
            <p className={`mt-3 text-base font-bold ${isSinging ? 'text-red-200' : 'text-emerald-200'}`}>
              {isSinging ? 'Cantando agora' : 'Aguardando canto'}
            </p>
          </div>

          <button
            type="button"
            onClick={toggleSinging}
            disabled={status !== 'running'}
            className={`mt-6 h-28 w-full rounded-lg text-3xl font-black shadow-xl transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${
              isSinging
                ? 'bg-red-500 text-white shadow-red-950/40'
                : 'bg-emerald-500 text-slate-950 shadow-emerald-950/40'
            }`}
          >
            {isSinging ? 'STOP CANTO' : 'START CANTO'}
          </button>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <button type="button" onClick={startTrial} disabled={status === 'running'} className="rounded-lg bg-yellow-300 px-3 py-4 text-sm font-black text-slate-950 disabled:opacity-45">
              INICIAR PROVA
            </button>
            <button type="button" onClick={pauseTrial} disabled={status !== 'running'} className="rounded-lg border border-white/15 bg-white/10 px-3 py-4 text-sm font-black text-white disabled:opacity-45">
              PAUSAR PROVA
            </button>
            <button type="button" onClick={() => resetTrial()} className="rounded-lg border border-red-300/30 bg-red-500/15 px-3 py-4 text-sm font-black text-red-100">
              ZERAR PROVA
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <StatCard label="Total cantado" value={formatTime(currentSungMs, true)} accent />
          <StatCard label="Aproveitamento" value={`${percent.toFixed(1)}%`} />
          <StatCard label="Maior sequência" value={formatTime(longestMs, true)} />
          <StatCard label="Entradas de canto" value={entries} />
        </section>

        {status === 'finished' && lastResult && (
          <section className="rounded-lg border border-yellow-300/40 bg-yellow-300/10 p-5 shadow-glow">
            <p className="text-sm font-black uppercase text-yellow-200">Resultado final</p>
            <h2 className="mt-1 text-2xl font-black text-white">{lastResult.canaryName || 'Prova concluída'}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <StatCard label="Total cantado" value={formatTime(lastResult.sungMs, true)} accent />
              <StatCard label="Tempo cantando" value={`${lastResult.percent.toFixed(1)}%`} />
              <StatCard label="Maior sequência" value={formatTime(lastResult.longestMs, true)} />
              <StatCard label="Entradas" value={lastResult.entries} />
            </div>
            <button type="button" onClick={() => resetTrial()} className="mt-4 w-full rounded-lg bg-yellow-300 px-4 py-4 text-lg font-black text-slate-950">
              Nova prova
            </button>
          </section>
        )}

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <h2 className="text-lg font-black text-white">Configurações</h2>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-bold text-slate-300">Nome do canário opcional</span>
              <input
                value={canaryName}
                onChange={(event) => setCanaryName(event.target.value)}
                placeholder="Ex.: Campeão"
                className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-yellow-300"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-bold text-slate-300">Tempo da prova</span>
              <select
                value={durationMode}
                onChange={(event) => changeDuration(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-yellow-300"
              >
                {DURATIONS.map((item) => (
                  <option key={item.label} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>

            {durationMode === 'custom' && (
              <label className="grid gap-2">
                <span className="text-sm font-bold text-slate-300">Minutos personalizados</span>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={customMinutes}
                  onChange={(event) => changeCustomMinutes(event.target.value)}
                  className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-yellow-300"
                />
              </label>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-black text-white">Histórico</h2>
            <button type="button" onClick={() => setHistory([])} className="rounded-md border border-red-300/30 px-3 py-2 text-sm font-bold text-red-100">
              Limpar histórico
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            {history.length === 0 && <p className="text-sm text-slate-400">Nenhuma prova salva ainda.</p>}
            {history.map((item) => (
              <article key={item.id} className="rounded-lg border border-white/10 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-black text-white">{item.canaryName || 'Canário sem nome'}</h3>
                    <p className="text-xs text-slate-400">{new Date(item.date).toLocaleString('pt-BR')}</p>
                  </div>
                  <span className="rounded-md bg-yellow-300/15 px-2 py-1 text-xs font-black text-yellow-200">{item.percent.toFixed(1)}%</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-300">
                  <p>Total: <strong className="text-white">{formatTime(item.sungMs, true)}</strong></p>
                  <p>Duração: <strong className="text-white">{formatTime(item.durationMs)}</strong></p>
                  <p>Maior seq.: <strong className="text-white">{formatTime(item.longestMs, true)}</strong></p>
                  <p>Entradas: <strong className="text-white">{item.entries}</strong></p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

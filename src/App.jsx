import { useEffect, useMemo, useRef, useState } from 'react'

const ASSET_BASE = import.meta.env.BASE_URL

const DURATIONS = [
  { label: '5 min', value: '300000' },
  { label: '10 min', value: '600000' },
  { label: '15 min', value: '900000' },
  { label: '20 min', value: '1200000' },
  { label: 'Personalizado', value: 'custom' }
]

const DEFAULT_DURATION = 300000
const DEFAULT_DURATION_MODE = '300000'
const DEFAULT_CUSTOM_MINUTES = 5
const HISTORY_LIMIT = 300
const SETTINGS_KEY = 'belga-timer-settings'
const HISTORY_KEY = 'belga-timer-history'
const RANKING_KEY = 'belga-timer-ranking'
const CHIEF_ACCESS_KEY = 'belga-timer-chief-access'
const WHATSAPP_SENT_KEY = 'belga-timer-whatsapp-sent'
const CHIEF_ACCESS_CODE = 'TROPAJF2026'

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY))
    const savedCustomMinutes = Number(saved?.customMinutes)
    const customMinutes = Number.isFinite(savedCustomMinutes)
      ? Math.max(1, Math.min(60, savedCustomMinutes))
      : DEFAULT_CUSTOM_MINUTES
    const savedDurationMode = saved?.durationMode || String(saved?.durationMs || DEFAULT_DURATION)
    const durationMode = DURATIONS.some((item) => item.value === savedDurationMode)
      ? savedDurationMode
      : DEFAULT_DURATION_MODE
    const durationMs = durationMode === 'custom'
      ? Math.max(60000, customMinutes * 60000)
      : Number(durationMode || DEFAULT_DURATION)

    return {
      durationMs: Number.isFinite(durationMs) ? durationMs : DEFAULT_DURATION,
      customMinutes,
      durationMode
    }
  } catch {
    return { durationMs: DEFAULT_DURATION, customMinutes: DEFAULT_CUSTOM_MINUTES, durationMode: DEFAULT_DURATION_MODE }
  }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []
  } catch {
    return []
  }
}

function loadRanking() {
  try {
    return JSON.parse(localStorage.getItem(RANKING_KEY)) || []
  } catch {
    return []
  }
}

function loadChiefAccess() {
  try {
    return localStorage.getItem(CHIEF_ACCESS_KEY) === 'granted'
  } catch {
    return false
  }
}

function loadWhatsAppSent() {
  try {
    return JSON.parse(localStorage.getItem(WHATSAPP_SENT_KEY)) || []
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

function parseTimeToMs(value) {
  const text = String(value || '').trim().replace(',', '.')
  if (!text) return 0

  if (!text.includes(':')) {
    const seconds = Number(text)
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0
  }

  const [minutesPart, secondsPart] = text.split(':')
  const minutes = Number(minutesPart)
  const seconds = Number(secondsPart)
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0
  return Math.max(0, (minutes * 60 + seconds) * 1000)
}

function rankingSourceId(result) {
  return result.sourceId || result.id
}

function rankingContentKey(result) {
  return [
    normalizeLabel(result.canaryName || 'canario sem nome'),
    formatTime(result.durationMs || 0),
    formatTime(result.sungMs || 0, true),
    formatTime(result.longestMs || 0, true),
    Number(result.entries || 0)
  ].join('|')
}

function isResultInRanking(ranking, result) {
  const sourceId = rankingSourceId(result)
  const contentKey = rankingContentKey(result)
  return ranking.some((item) => rankingSourceId(item) === sourceId || rankingContentKey(item) === contentKey)
}

function dedupeRanking(items) {
  const seen = new Set()

  return items.filter((item) => {
    const keys = [rankingSourceId(item), rankingContentKey(item)]
    const duplicated = keys.some((key) => seen.has(key))
    keys.forEach((key) => seen.add(key))
    return !duplicated
  })
}

function normalizeLabel(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function getWhatsAppLineValue(lines, labels) {
  const normalizedLabels = labels.map(normalizeLabel)
  const line = lines.find((item) => {
    const normalized = normalizeLabel(item)
    return normalizedLabels.some((label) => normalized.startsWith(`${label}:`))
  })

  if (!line) return ''
  return line.split(':').slice(1).join(':').trim()
}

function parseWhatsAppResult(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const canaryName = getWhatsAppLineValue(lines, ['Canário', 'Canario'])
  const dateText = getWhatsAppLineValue(lines, ['Data'])
  const durationText = getWhatsAppLineValue(lines, ['Duração da prova', 'Duracao da prova'])
  const sungText = getWhatsAppLineValue(lines, ['Tempo total cantado'])
  const longestText = getWhatsAppLineValue(lines, ['Maior sequência', 'Maior sequencia'])
  const entriesText = getWhatsAppLineValue(lines, ['Entradas de canto', 'Entradas'])

  const durationMs = parseTimeToMs(durationText)
  const sungMs = parseTimeToMs(sungText)
  const longestMs = parseTimeToMs(longestText)
  const entries = Math.max(0, Number(String(entriesText).replace(/\D/g, '')) || 0)

  if (!canaryName || durationMs <= 0 || sungMs <= 0) return null

  return {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    sourceId: `whatsapp|${canaryName}|${dateText}|${durationMs}|${sungMs}|${longestMs}|${entries}`,
    date: new Date().toISOString(),
    canaryName,
    durationMs,
    sungMs,
    percent: durationMs ? (sungMs / durationMs) * 100 : 0,
    longestMs,
    entries
  }
}

function buildWhatsAppUrl(result) {
  const canary = result.canaryName || 'Canário sem nome'
  const date = new Date(result.date).toLocaleString('pt-BR')
  const message = [
    '🏆 Resultado - Tropa dos Belgas',
    '',
    `Canário: ${canary}`,
    `Data: ${date}`,
    `Duração da prova: ${formatTime(result.durationMs)}`,
    `Tempo total cantado: ${formatTime(result.sungMs, true)}`,
    `Aproveitamento: ${result.percent.toFixed(1)}%`,
    `Maior sequência: ${formatTime(result.longestMs, true)}`,
    `Entradas de canto: ${result.entries}`,
    '',
    'Cronometrado pelo app Tropa dos Belgas.'
  ].join('\n')

  return `https://wa.me/?text=${encodeURIComponent(message)}`
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

function ChampionReport({ champion, championRanking }) {
  const generatedAt = new Date()

  return (
    <section className="print-report">
      <div className="print-watermark">
        <img src={`${ASSET_BASE}icon.svg`} alt="" />
        <span>TROPA DOS BELGAS JF</span>
      </div>
      <header className="print-header">
        <div className="print-rule-ribbon">PADRAO E REGRA FOB</div>
        <img className="print-header-canary print-header-canary-left" src={`${ASSET_BASE}canary-icon-transparent.png`} alt="" />
        <img className="print-header-canary print-header-canary-right" src={`${ASSET_BASE}canary-icon-transparent.png`} alt="" />
        <div className="print-wing"></div>
        <h1>TROPA DOS BELGAS</h1>
        <p>DESDE 2018 - TROPA JF</p>
        <h2>RESULTADO FINAL DA RODA</h2>
        <div className="print-ribbon">CAMPEAO POR TEMPO TOTAL CANTADO</div>
        <div className="print-info-row">
          <span>DATA: {generatedAt.toLocaleDateString('pt-BR')}</span>
          <span>HORA: {generatedAt.toLocaleTimeString('pt-BR')}</span>
          <span>JUIZ DE FORA MG</span>
        </div>
      </header>

      {champion ? (
        <section className="print-champion">
          <div className="print-champion-title">CAMPEAO DA RODA</div>
          <div className="print-champion-grid">
            <div className="print-champion-name">
              <img className="print-canary-icon" src={`${ASSET_BASE}canary-icon-transparent.png`} alt="" />
              <span>Canario</span>
              <h2>{champion.canaryName}</h2>
            </div>
            <div>
              <span>Total geral</span>
              <strong>{formatTime(champion.totalSungMs, true)}</strong>
            </div>
            <div>
              <span>Provas</span>
              <strong>{champion.trials}</strong>
            </div>
            <div>
              <span>Melhor prova</span>
              <strong>{formatTime(champion.bestTrialMs, true)}</strong>
            </div>
            <div>
              <span>Entradas totais</span>
              <strong>{champion.totalEntries}</strong>
            </div>
          </div>
        </section>
      ) : (
        <section className="print-empty">Nenhum resultado adicionado ao painel.</section>
      )}

      <div className="print-table-title">
        <span>CLASSIFICACAO GERAL</span>
        <strong>RESULTADO DO DIA</strong>
      </div>

      <table className="print-table">
        <thead>
          <tr>
            <th>POS</th>
            <th>CANARIO</th>
            <th>TOTAL GERAL</th>
            <th>PROVAS</th>
            <th>MELHOR PROVA</th>
            <th>ENTRADAS</th>
          </tr>
        </thead>
        <tbody>
          {championRanking.map((item, index) => (
            <tr key={item.id}>
              <td><span className={`print-position print-position-${index + 1}`}>{index + 1}</span></td>
              <td>{item.canaryName}</td>
              <td>{formatTime(item.totalSungMs, true)}</td>
              <td>{item.trials}</td>
              <td>{formatTime(item.bestTrialMs, true)}</td>
              <td>{item.totalEntries}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="print-footer">
        <div className="print-footer-title">
          <span>TORNEIO CANTO FIBRA</span>
          <strong>TROPA DOS BELGAS JF</strong>
        </div>
        <div>
          <span></span>
          <p>Chefe de roda</p>
        </div>
        <img className="print-footer-canary print-footer-canary-left" src={`${ASSET_BASE}canary-icon-transparent.png`} alt="" />
        <img className="print-footer-logo" src={`${ASSET_BASE}icon.svg`} alt="" />
        <div>
          <span></span>
          <p>Organizacao</p>
        </div>
        <img className="print-footer-canary print-footer-canary-right" src={`${ASSET_BASE}canary-icon-transparent.png`} alt="" />
      </footer>

      <p className="print-dev">Gerado pelo app Tropa dos Belgas - Desenvolvido por Leandro Ventura</p>
    </section>
  )
}

function buildChampionRanking(results) {
  const grouped = new Map()

  results.forEach((item) => {
    const name = item.canaryName || 'Canario sem nome'
    const key = normalizeLabel(name)
    const current = grouped.get(key) || {
      canaryName: name,
      totalSungMs: 0,
      totalDurationMs: 0,
      totalEntries: 0,
      bestTrialMs: 0,
      bestSequenceMs: 0,
      trials: 0,
      dates: [],
      durations: new Set()
    }

    current.totalSungMs += item.sungMs || 0
    current.totalDurationMs += item.durationMs || 0
    current.totalEntries += item.entries || 0
    current.bestTrialMs = Math.max(current.bestTrialMs, item.sungMs || 0)
    current.bestSequenceMs = Math.max(current.bestSequenceMs, item.longestMs || 0)
    current.trials += 1
    current.dates.push(item.date)
    current.durations.add(formatTime(item.durationMs || 0))
    grouped.set(key, current)
  })

  return [...grouped.values()]
    .map((item) => ({
      ...item,
      id: normalizeLabel(item.canaryName),
      percent: item.totalDurationMs ? (item.totalSungMs / item.totalDurationMs) * 100 : 0,
      durationsText: [...item.durations].join(' + '),
      lastDate: item.dates.sort().at(-1)
    }))
    .sort((a, b) => b.totalSungMs - a.totalSungMs || b.bestTrialMs - a.bestTrialMs || b.totalEntries - a.totalEntries)
}

function RankingPanel({ ranking, setRanking, history }) {
  const [whatsAppText, setWhatsAppText] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [rankingView, setRankingView] = useState('byTrial')
  const [form, setForm] = useState({
    canaryName: '',
    sungTime: '',
    durationMinutes: '5',
    longestTime: '',
    entries: ''
  })

  const sortedRanking = [...ranking].sort((a, b) => b.sungMs - a.sungMs)
  const championRanking = buildChampionRanking(ranking)
  const champion = championRanking[0]
  const best = sortedRanking[0]
  const totalEntries = sortedRanking.length
  const average = totalEntries
    ? sortedRanking.reduce((sum, item) => sum + item.sungMs, 0) / totalEntries
    : 0

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function importWhatsAppResult() {
    const result = parseWhatsAppResult(whatsAppText)

    if (!result) {
      setImportStatus('Nao consegui ler a mensagem. Confira se ela veio do app.')
      return
    }

    if (isResultInRanking(ranking, result)) {
      setImportStatus('Esse resultado ja esta na classificacao.')
      return
    }

    setRanking((current) => {
      if (isResultInRanking(current, result)) return current
      return dedupeRanking([result, ...current])
    })
    setWhatsAppText('')
    setImportStatus('Resultado importado para a classificacao.')
  }

  function addManualResult(event) {
    event.preventDefault()
    const sungMs = parseTimeToMs(form.sungTime)
    const durationMs = Math.max(1, Number(form.durationMinutes) || 5) * 60000
    const longestMs = parseTimeToMs(form.longestTime)

    if (!form.canaryName.trim() || sungMs <= 0) return

    const result = {
      id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
      date: new Date().toISOString(),
      canaryName: form.canaryName.trim(),
      durationMs,
      sungMs,
      percent: durationMs ? (sungMs / durationMs) * 100 : 0,
      longestMs,
      entries: Math.max(0, Number(form.entries) || 0)
    }

    setRanking((current) => dedupeRanking([result, ...current]))
    setForm({ canaryName: '', sungTime: '', durationMinutes: form.durationMinutes, longestTime: '', entries: '' })
  }

  function addFromHistory(item) {
    setRanking((current) => {
      if (isResultInRanking(current, item)) return current

      return dedupeRanking([
        {
          ...item,
          id: globalThis.crypto?.randomUUID?.() || `${item.id}-${Date.now()}`,
          sourceId: rankingSourceId(item),
          importedAt: new Date().toISOString()
        },
        ...current
      ])
    })
  }

  function removeRankingItem(id) {
    setRanking((current) => current.filter((item) => item.id !== id))
  }

  function requestFullscreen() {
    document.documentElement.requestFullscreen?.()
  }

  function printChampionReport() {
    if (!champion) return
    window.print()
  }

  return (
    <>
    <div className="mx-auto grid w-full max-w-7xl gap-5">
      <section className="rounded-lg border border-yellow-300/30 bg-slate-950/80 p-5 shadow-glow">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <img src={`${ASSET_BASE}icon.svg`} alt="" className="h-16 w-16 rounded-lg border border-yellow-300/30 bg-slate-950" />
            <div>
              <p className="text-sm font-black uppercase tracking-wide text-yellow-200">Tropa JF</p>
              <h2 className="text-4xl font-black leading-tight text-white lg:text-6xl">Classificacao Geral</h2>
              <p className="mt-1 text-base font-semibold text-slate-300">
                {rankingView === 'champion' ? 'Campeao da roda por soma de provas' : 'Ranking por tempo total cantado'}
              </p>
            </div>
          </div>
          <button type="button" onClick={requestFullscreen} className="rounded-lg border border-yellow-300/30 bg-yellow-300/10 px-5 py-4 text-sm font-black uppercase text-yellow-100">
            Tela cheia
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {rankingView === 'champion' ? (
            <>
              <StatCard label="Canarios classificados" value={championRanking.length} accent />
              <StatCard label="Lider atual" value={champion ? champion.canaryName : '-'} />
              <StatCard label="Total do lider" value={champion ? formatTime(champion.totalSungMs, true) : '00:00.0'} />
            </>
          ) : (
            <>
              <StatCard label="Provas no painel" value={totalEntries} accent />
              <StatCard label="Melhor tempo" value={best ? formatTime(best.sungMs, true) : '00:00.0'} />
              <StatCard label="Media cantada" value={formatTime(average, true)} />
            </>
          )}
        </div>

        <div className="mt-5 grid overflow-hidden rounded-lg border border-yellow-300/30 bg-slate-950/80 p-1 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setRankingView('byTrial')}
            className={`rounded-md px-4 py-3 text-base font-black ${rankingView === 'byTrial' ? 'bg-yellow-300 text-slate-950' : 'text-slate-300'}`}
          >
            POR PROVA
          </button>
          <button
            type="button"
            onClick={() => setRankingView('champion')}
            className={`rounded-md px-4 py-3 text-base font-black ${rankingView === 'champion' ? 'bg-yellow-300 text-slate-950' : 'text-slate-300'}`}
          >
            CAMPEAO DA RODA
          </button>
        </div>
      </section>

      {rankingView === 'byTrial' && (
      <section className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/80">
          <div className="grid grid-cols-[56px_minmax(120px,1.1fr)_76px_112px_82px_104px_68px] gap-2 border-b border-white/10 bg-white/[0.05] px-3 py-3 text-xs font-black uppercase tracking-wide text-slate-400">
            <span>Pos</span>
            <span>Canario</span>
            <span className="text-yellow-200">Prova</span>
            <span>Total</span>
            <span>Aprov.</span>
            <span>Maior seq.</span>
            <span>Ent.</span>
          </div>

          {sortedRanking.length === 0 && (
            <div className="p-8 text-center text-lg font-semibold text-slate-400">
              Nenhum resultado adicionado ao painel ainda.
            </div>
          )}

          <div className="divide-y divide-white/10">
            {sortedRanking.map((item, index) => (
              <article key={item.id} className={`grid grid-cols-[56px_minmax(120px,1.1fr)_76px_112px_82px_104px_68px] items-center gap-2 px-3 py-4 ${index < 3 ? 'bg-yellow-300/10' : ''}`}>
                <div className={`grid h-12 w-12 place-items-center rounded-lg text-xl font-black ${index === 0 ? 'bg-yellow-300 text-slate-950' : index === 1 ? 'bg-slate-300 text-slate-950' : index === 2 ? 'bg-orange-400 text-slate-950' : 'bg-white/10 text-white'}`}>
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xl font-black text-white lg:text-2xl" title={item.canaryName || 'Canario sem nome'}>{item.canaryName || 'Canario sem nome'}</p>
                  <p className="text-xs font-semibold text-slate-500">{new Date(item.date).toLocaleString('pt-BR')}</p>
                </div>
                <p className="rounded-lg border border-yellow-300/30 bg-yellow-300/10 px-2 py-2 text-center font-mono text-lg font-black text-yellow-200 lg:text-2xl">{formatTime(item.durationMs)}</p>
                <p className="font-mono text-2xl font-black text-yellow-200 lg:text-3xl">{formatTime(item.sungMs, true)}</p>
                <p className="text-xl font-black text-white lg:text-2xl">{item.percent.toFixed(1)}%</p>
                <p className="font-mono text-xl font-black text-white lg:text-2xl">{formatTime(item.longestMs, true)}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xl font-black text-white lg:text-2xl">{item.entries}</span>
                  <button type="button" onClick={() => removeRankingItem(item.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-red-300/30 text-xs font-black text-red-100">
                    X
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="grid gap-5">
          <section className="rounded-lg border border-yellow-300/30 bg-yellow-300/10 p-4 shadow-glow">
            <h3 className="text-lg font-black text-white">Importar do WhatsApp</h3>
            <p className="mt-1 text-sm font-semibold text-slate-300">Cole aqui a mensagem recebida do avaliador.</p>
            <textarea
              value={whatsAppText}
              onChange={(event) => {
                setWhatsAppText(event.target.value)
                setImportStatus('')
              }}
              placeholder={`Canario: Teste03\nDuracao da prova: 01:00\nTempo total cantado: 00:27.7\nMaior sequencia: 00:05.5\nEntradas de canto: 8`}
              rows="8"
              className="mt-4 w-full resize-y rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-yellow-300"
            />
            {importStatus && <p className="mt-3 text-sm font-bold text-yellow-100">{importStatus}</p>}
            <button type="button" onClick={importWhatsAppResult} className="mt-4 w-full rounded-lg bg-yellow-300 px-4 py-4 text-base font-black text-slate-950">
              Importar resultado
            </button>
          </section>

          <form onSubmit={addManualResult} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <h3 className="text-lg font-black text-white">Adicionar resultado</h3>
            <div className="mt-4 grid gap-3">
              <input value={form.canaryName} onChange={(event) => updateForm('canaryName', event.target.value)} placeholder="Nome do canario" className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-yellow-300" />
              <input value={form.sungTime} onChange={(event) => updateForm('sungTime', event.target.value)} placeholder="Tempo cantado. Ex.: 03:58.1" className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-yellow-300" />
              <div className="grid grid-cols-2 gap-3">
                <input value={form.durationMinutes} onChange={(event) => updateForm('durationMinutes', event.target.value)} placeholder="Prova min" className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-yellow-300" />
                <input value={form.entries} onChange={(event) => updateForm('entries', event.target.value)} placeholder="Entradas" className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-yellow-300" />
              </div>
              <input value={form.longestTime} onChange={(event) => updateForm('longestTime', event.target.value)} placeholder="Maior sequencia. Ex.: 00:41.3" className="rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-yellow-300" />
              <button type="submit" className="rounded-lg bg-yellow-300 px-4 py-4 text-base font-black text-slate-950">
                Adicionar ao painel
              </button>
            </div>
          </form>

          <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-black text-white">Historico recente</h3>
              <button type="button" onClick={() => setRanking([])} className="rounded-md border border-red-300/30 px-3 py-2 text-sm font-bold text-red-100">
                Limpar painel
              </button>
            </div>
            <div className="mt-4 grid max-h-[520px] gap-3 overflow-auto pr-1">
              {history.length === 0 && <p className="text-sm text-slate-400">Nenhuma prova no historico.</p>}
              {history.map((item) => {
                const alreadySent = isResultInRanking(ranking, item)

                return (
                <article key={item.id} className="rounded-lg border border-white/10 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-black text-white">{item.canaryName || 'Canario sem nome'}</p>
                      <p className="text-xs text-slate-400">{formatTime(item.sungMs, true)} - {item.percent.toFixed(1)}%</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addFromHistory(item)}
                      disabled={alreadySent}
                      className={`rounded-md px-3 py-2 text-xs font-black ${alreadySent ? 'cursor-not-allowed bg-slate-700 text-slate-300' : 'bg-emerald-500 text-slate-950'}`}
                    >
                      {alreadySent ? 'Ja enviado' : 'Enviar ao painel'}
                    </button>
                  </div>
                </article>
                )
              })}
            </div>
          </section>
        </div>
      </section>
      )}

      {rankingView === 'champion' && (
        <section className="grid gap-5 lg:grid-cols-[1.35fr_0.75fr]">
          <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/80">
            <div className="grid grid-cols-[56px_minmax(120px,1.1fr)_112px_70px_104px_68px] gap-2 border-b border-white/10 bg-white/[0.05] px-3 py-3 text-xs font-black uppercase tracking-wide text-slate-400">
              <span>Pos</span>
              <span>Canario</span>
              <span className="text-yellow-200">Total geral</span>
              <span className="text-center">Provas</span>
              <span>Melhor prova</span>
              <span>Entradas</span>
            </div>

            {championRanking.length === 0 && (
              <div className="p-8 text-center text-lg font-semibold text-slate-400">
                Nenhum resultado adicionado ao painel ainda.
              </div>
            )}

            <div className="divide-y divide-white/10">
              {championRanking.map((item, index) => (
                <article key={item.id} className={`grid grid-cols-[56px_minmax(120px,1.1fr)_112px_70px_104px_68px] items-center gap-2 px-3 py-4 ${index < 3 ? 'bg-yellow-300/10' : ''}`}>
                  <div className={`grid h-12 w-12 place-items-center rounded-lg text-xl font-black ${index === 0 ? 'bg-yellow-300 text-slate-950' : index === 1 ? 'bg-slate-300 text-slate-950' : index === 2 ? 'bg-orange-400 text-slate-950' : 'bg-white/10 text-white'}`}>
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xl font-black text-white lg:text-2xl" title={item.canaryName}>{item.canaryName}</p>
                    <p className="text-xs font-semibold text-slate-500">{item.lastDate ? new Date(item.lastDate).toLocaleString('pt-BR') : '-'}</p>
                  </div>
                  <p className="font-mono text-2xl font-black text-yellow-200 lg:text-3xl">{formatTime(item.totalSungMs, true)}</p>
                  <p className="text-center text-2xl font-black text-white lg:text-3xl">{item.trials}</p>
                  <p className="font-mono text-xl font-black text-yellow-200 lg:text-2xl">{formatTime(item.bestTrialMs, true)}</p>
                  <p className="text-2xl font-black text-white lg:text-3xl">{item.totalEntries}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="grid gap-5 self-start">
            <section className="rounded-lg border border-yellow-300/30 bg-yellow-300/10 p-5 shadow-glow">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-black uppercase tracking-wide text-yellow-200">Campeao da roda</p>
                <button
                  type="button"
                  onClick={printChampionReport}
                  disabled={!champion}
                  className="rounded-md bg-yellow-300 px-3 py-2 text-xs font-black uppercase text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Gerar PDF
                </button>
              </div>
              {champion ? (
                <>
                  <h3 className="mt-2 text-4xl font-black text-white">{champion.canaryName}</h3>
                  <div className="mt-5 grid gap-3">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <span className="text-sm font-bold text-slate-300">Total geral</span>
                      <strong className="font-mono text-3xl text-yellow-200">{formatTime(champion.totalSungMs, true)}</strong>
                    </div>
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <span className="text-sm font-bold text-slate-300">Provas</span>
                      <strong className="text-2xl text-white">{champion.trials}</strong>
                    </div>
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <span className="text-sm font-bold text-slate-300">Duracoes</span>
                      <strong className="text-right text-base text-white">{champion.durationsText || '-'}</strong>
                    </div>
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <span className="text-sm font-bold text-slate-300">Melhor prova</span>
                      <strong className="font-mono text-2xl text-yellow-200">{formatTime(champion.bestTrialMs, true)}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-300">Entradas totais</span>
                      <strong className="text-2xl text-white">{champion.totalEntries}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm font-semibold text-slate-300">Importe ou envie resultados na aba Por prova para montar o campeao da roda.</p>
              )}
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <h3 className="text-lg font-black text-white">Como funciona</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
                Esta tela soma todas as provas do mesmo canario. A classificacao final fica pelo tempo total cantado, e a melhor prova mostra o maior tempo que ele fez em uma unica prova.
              </p>
            </section>
          </aside>
        </section>
      )}
    </div>
    <ChampionReport champion={champion} championRanking={championRanking} />
    </>
  )
}

export default function App() {
  const initialSettings = useMemo(loadSettings, [])
  const [viewMode, setViewMode] = useState('timer')
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
  const [ranking, setRanking] = useState(loadRanking)
  const [chiefAccessGranted, setChiefAccessGranted] = useState(loadChiefAccess)
  const [whatsAppSentIds, setWhatsAppSentIds] = useState(loadWhatsAppSent)
  const [chiefCode, setChiefCode] = useState('')
  const [chiefAccessModalOpen, setChiefAccessModalOpen] = useState(false)
  const [chiefAccessError, setChiefAccessError] = useState('')

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
  const wakeLockRef = useRef(null)
  const wakeLockRequestRef = useRef(false)

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
    localStorage.setItem(WHATSAPP_SENT_KEY, JSON.stringify(whatsAppSentIds))
  }, [whatsAppSentIds])

  useEffect(() => {
    const cleaned = dedupeRanking(ranking)
    if (cleaned.length !== ranking.length) {
      setRanking(cleaned)
      return
    }

    localStorage.setItem(RANKING_KEY, JSON.stringify(cleaned))
  }, [ranking])

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

  useEffect(() => {
    async function keepScreenAwake() {
      if (status !== 'running') {
        releaseWakeLock()
        return
      }

      await requestWakeLock()
    }

    keepScreenAwake()

    return () => {
      if (status !== 'running') releaseWakeLock()
    }
  }, [status])

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && statusRef.current === 'running') {
        requestWakeLock()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  const currentSungMs = status === 'running' && isSinging && singingStartRef.current
    ? sungMs + (performance.now() - singingStartRef.current)
    : sungMs
  const percent = durationMs ? Math.min(100, (currentSungMs / durationMs) * 100) : 0
  const oneMinuteWarning = status === 'running' && remainingMs <= 60000

  function startTrial() {
    if (!canaryNameRef.current.trim() || durationRef.current < 60000) return
    if (status === 'finished') resetTrial()
    lastTickRef.current = performance.now()
    setStatus('running')
    requestWakeLock()
  }

  function pauseTrial() {
    if (status !== 'running') return
    const now = performance.now()
    if (singingRef.current) closeSingingSegment(now, true)
    setStatus('paused')
    releaseWakeLock()
  }

  function resetTrial(nextDuration = durationRef.current) {
    releaseWakeLock()
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
    releaseWakeLock()

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
    setHistory((current) => [result, ...current].slice(0, HISTORY_LIMIT))
    playFinishBeep()
    vibrate([180, 80, 180])
  }

  async function requestWakeLock() {
    try {
      if (!('wakeLock' in navigator) || wakeLockRef.current || wakeLockRequestRef.current || document.visibilityState !== 'visible') return

      wakeLockRequestRef.current = true
      wakeLockRef.current = await navigator.wakeLock.request('screen')
      wakeLockRequestRef.current = false
      wakeLockRef.current.addEventListener('release', () => {
        wakeLockRef.current = null
      })
    } catch {
      wakeLockRequestRef.current = false
      wakeLockRef.current = null
    }
  }

  async function releaseWakeLock() {
    try {
      wakeLockRequestRef.current = false
      if (!wakeLockRef.current) return

      const lock = wakeLockRef.current
      wakeLockRef.current = null
      await lock.release()
    } catch {
      wakeLockRef.current = null
    }
  }

  function changeDuration(value) {
    setDurationMode(value)
    const next = value === 'custom' ? Math.max(60000, customMinutes * 60000) : Number(value)
    setDurationMs(next)
    if (status === 'idle' || status === 'finished') resetTrial(next)
  }

  function changeCustomMinutes(value) {
    setDurationMode('custom')

    if (value === '') {
      setCustomMinutes('')
      return
    }

    const minutes = Math.max(1, Math.min(60, Number(value) || 1))
    setCustomMinutes(minutes)
    setDurationMs(minutes * 60000)
    if (status === 'idle' || status === 'finished') resetTrial(minutes * 60000)
  }

  function finishCustomMinutesEdit() {
    if (customMinutes !== '') return

    setCustomMinutes(1)
    setDurationMs(60000)
    if (status === 'idle' || status === 'finished') resetTrial(60000)
  }

  function addResultToRanking(result) {
    setRanking((current) => {
      if (isResultInRanking(current, result)) return current

      return dedupeRanking([
        {
          ...result,
          id: globalThis.crypto?.randomUUID?.() || `${result.id}-${Date.now()}`,
          sourceId: rankingSourceId(result),
          importedAt: new Date().toISOString()
        },
        ...current
      ])
    })
  }

  function whatsAppSentKey(result) {
    return result.sourceId || result.id
  }

  function isWhatsAppSent(result) {
    return whatsAppSentIds.includes(whatsAppSentKey(result))
  }

  function markWhatsAppSent(result) {
    const sentKey = whatsAppSentKey(result)
    setWhatsAppSentIds((current) => current.includes(sentKey) ? current : [sentKey, ...current].slice(0, HISTORY_LIMIT))
  }

  function openChiefPanel() {
    if (!canOpenRanking) return

    if (chiefAccessGranted) {
      setViewMode('ranking')
      return
    }

    setChiefCode('')
    setChiefAccessError('')
    setChiefAccessModalOpen(true)
  }

  function submitChiefCode(event) {
    event.preventDefault()

    if (chiefCode.trim().toUpperCase() !== CHIEF_ACCESS_CODE) {
      setChiefAccessError('Codigo incorreto. Area liberada somente para responsaveis.')
      return
    }

    localStorage.setItem(CHIEF_ACCESS_KEY, 'granted')
    setChiefAccessGranted(true)
    setChiefAccessModalOpen(false)
    setChiefCode('')
    setChiefAccessError('')
    setViewMode('ranking')
  }

  const lastResult = history[0]
  const lastResultInRanking = lastResult ? isResultInRanking(ranking, lastResult) : false
  const lastResultWhatsAppSent = lastResult ? isWhatsAppSent(lastResult) : false
  const canOpenRanking = status === 'idle' || status === 'finished'
  const hasRequiredTrialData = canaryName.trim().length > 0 && durationMs >= 60000
  const canStartTrial = status !== 'running' && hasRequiredTrialData

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#3b2f16_0,#111827_35%,#020617_78%)] px-4 py-5 text-slate-100 safe-bottom">
      <div className={`app-shell mx-auto flex w-full flex-col gap-5 ${viewMode === 'ranking' ? 'max-w-7xl' : 'max-w-2xl'}`}>
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

          <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-slate-950/70 p-1">
            <button
              type="button"
              onClick={() => setViewMode('timer')}
              className={`rounded-md px-4 py-3 text-sm font-black uppercase ${viewMode === 'timer' ? 'bg-yellow-300 text-slate-950' : 'text-slate-300'}`}
            >
              Cronometro
            </button>
            <button
              type="button"
              onClick={openChiefPanel}
              disabled={!canOpenRanking}
              className={`rounded-md px-4 py-3 text-sm font-black uppercase ${
                viewMode === 'ranking'
                  ? 'bg-yellow-300 text-slate-950'
                  : canOpenRanking
                    ? 'text-slate-300'
                    : 'cursor-not-allowed text-slate-600 opacity-50'
              }`}
            >
              Chefe de Roda
            </button>
          </div>
        </header>

        {chiefAccessModalOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 px-4 backdrop-blur-sm">
            <form onSubmit={submitChiefCode} className="w-full max-w-sm rounded-xl border border-yellow-300/35 bg-slate-950 p-5 shadow-glow">
              <div className="flex items-center gap-3">
                <img
                  src={`${ASSET_BASE}icon.svg`}
                  alt=""
                  className="h-12 w-12 rounded-lg border border-yellow-300/30 bg-black object-cover"
                />
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-yellow-200">Acesso restrito</p>
                  <h2 className="text-xl font-black text-white">Chefe de Roda</h2>
                </div>
              </div>

              <label className="mt-5 grid gap-2">
                <span className="text-sm font-bold text-slate-300">Digite o codigo para abrir o painel</span>
                <input
                  type="password"
                  value={chiefCode}
                  onChange={(event) => {
                    setChiefCode(event.target.value)
                    setChiefAccessError('')
                  }}
                  autoFocus
                  autoComplete="off"
                  inputMode="text"
                  className="rounded-lg border border-white/10 bg-slate-900 px-4 py-3 text-center text-lg font-black uppercase tracking-widest text-white outline-none focus:border-yellow-300"
                />
              </label>

              {chiefAccessError && (
                <p className="mt-3 rounded-md border border-red-300/30 bg-red-500/15 px-3 py-2 text-sm font-bold text-red-100">
                  {chiefAccessError}
                </p>
              )}

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setChiefAccessModalOpen(false)
                    setChiefCode('')
                    setChiefAccessError('')
                  }}
                  className="rounded-lg border border-white/15 bg-white/10 px-4 py-3 text-sm font-black uppercase text-white"
                >
                  Cancelar
                </button>
                <button type="submit" className="rounded-lg bg-yellow-300 px-4 py-3 text-sm font-black uppercase text-slate-950">
                  Liberar
                </button>
              </div>
            </form>
          </div>
        )}

        {viewMode === 'ranking' && (
          <>
            <RankingPanel ranking={ranking} setRanking={setRanking} history={history} />
            <footer className="pb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
              Desenvolvido por Leandro Ventura
            </footer>
          </>
        )}

        {viewMode === 'timer' && (
          <>

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
            <button
              type="button"
              onClick={startTrial}
              disabled={!canStartTrial}
              className={`rounded-lg px-3 py-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-70 ${
                hasRequiredTrialData
                  ? 'bg-yellow-300 text-slate-950'
                  : 'missing-data-alert border border-red-200 bg-red-600 text-white shadow-lg shadow-red-950/40'
              }`}
            >
              {hasRequiredTrialData ? 'INICIAR PROVA' : 'PREENCHA OS DADOS'}
            </button>
            <button type="button" onClick={pauseTrial} disabled={status !== 'running'} className="rounded-lg border border-white/15 bg-white/10 px-3 py-4 text-sm font-black text-white disabled:opacity-45">
              PAUSAR PROVA
            </button>
            <button type="button" onClick={() => resetTrial()} className="rounded-lg border border-red-300/30 bg-red-500/15 px-3 py-4 text-sm font-black text-red-100">
              ZERAR PROVA
            </button>
          </div>
          {status !== 'running' && (
            <p className="mt-3 text-center text-xs font-bold uppercase tracking-wide text-yellow-200">
              {hasRequiredTrialData
                ? 'Tudo pronto. Aguarde o chefe da roda autorizar o inicio da prova.'
                : 'Preencha o nome do canario e o tempo da prova para iniciar'}
            </p>
          )}
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
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <a
                href={buildWhatsAppUrl(lastResult)}
                target="_blank"
                rel="noreferrer"
                onClick={() => markWhatsAppSent(lastResult)}
                className={`rounded-lg px-4 py-4 text-center text-lg font-black ${lastResultWhatsAppSent ? 'border border-emerald-300/40 bg-emerald-500/15 text-emerald-100' : 'send-result-alert bg-emerald-500 text-slate-950'}`}
              >
                {lastResultWhatsAppSent ? 'Resultado enviado com sucesso' : 'Enviar resultado ao chefe de roda'}
              </a>
              <button type="button" onClick={() => resetTrial()} className="rounded-lg bg-yellow-300 px-4 py-4 text-lg font-black text-slate-950">
                Nova prova
              </button>
            </div>
            {chiefAccessGranted && (
              <button
                type="button"
                onClick={() => addResultToRanking(lastResult)}
                disabled={lastResultInRanking}
                className={`mt-3 w-full rounded-lg border px-4 py-4 text-lg font-black ${lastResultInRanking ? 'cursor-not-allowed border-slate-600 bg-slate-700/60 text-slate-300' : 'border-yellow-300/40 bg-yellow-300/10 text-yellow-100'}`}
              >
                {lastResultInRanking ? 'Resultado ja esta na classificacao' : 'Enviar ao painel do chefe'}
              </button>
            )}
          </section>
        )}

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <h2 className="text-lg font-black text-white">Configurações</h2>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-bold text-slate-300">Nome do canário obrigatório</span>
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
                  onBlur={finishCustomMinutesEdit}
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
            {history.map((item) => {
              const whatsAppSent = isWhatsAppSent(item)

              return (
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
                <a
                  href={buildWhatsAppUrl(item)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => markWhatsAppSent(item)}
                  className={`mt-3 block rounded-lg px-4 py-3 text-center text-sm font-black ${whatsAppSent ? 'border border-emerald-300/40 bg-emerald-500/15 text-emerald-100' : 'send-result-alert bg-emerald-500 text-slate-950'}`}
                >
                  {whatsAppSent ? 'Resultado enviado com sucesso' : 'Enviar resultado ao chefe de roda'}
                </a>
                {chiefAccessGranted && (
                  <button
                    type="button"
                    onClick={() => addResultToRanking(item)}
                    disabled={isResultInRanking(ranking, item)}
                    className={`mt-3 w-full rounded-lg border px-4 py-3 text-center text-sm font-black ${isResultInRanking(ranking, item) ? 'cursor-not-allowed border-slate-600 bg-slate-700/60 text-slate-300' : 'border-yellow-300/40 bg-yellow-300/10 text-yellow-100'}`}
                  >
                    {isResultInRanking(ranking, item) ? 'Resultado ja esta na classificacao' : 'Enviar ao painel do chefe'}
                  </button>
                )}
              </article>
              )
            })}
          </div>
        </section>

        <footer className="pb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
          Desenvolvido por Leandro Ventura
        </footer>
          </>
        )}
      </div>
    </main>
  )
}

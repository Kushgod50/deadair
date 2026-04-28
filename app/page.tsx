'use client'

import { useState, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Chapter {
  timestamp: string
  seconds: number
  title: string
  type: string
}

interface CutSegment {
  start: string
  end: string
  startSeconds: number
  endSeconds: number
  reason: string
  type: string
}

interface Result {
  vodId: string
  vodTitle: string
  streamer: string
  totalDuration: string
  totalDurationSeconds: number
  chapters: Chapter[]
  cuts: CutSegment[]
  estimatedSavedMinutes: number
  summary: string
  edlContent: string
  chaptersTxt: string
  ffmpegScript: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function download(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function fmtSecs(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const CUT_COLORS: Record<string, string> = {
  silence: '#FF6B6B',
  afk: '#FFB347',
  filler: '#9146FF',
  technical: '#60A5FA',
  low_energy: '#A3A3A3',
}

const CHAPTER_ICONS: Record<string, string> = {
  stream_start: '▶',
  highlight: '★',
  game_change: '◆',
  topic_change: '●',
  stream_end: '■',
}

// ─── Components ───────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: '#9146FF',
            display: 'inline-block',
            animation: `blink 1.2s ${i * 0.2}s ease-in-out infinite`,
          }}
        />
      ))}
    </span>
  )
}

function Timeline({ cuts, total }: { cuts: CutSegment[]; total: number }) {
  const [hover, setHover] = useState<CutSegment | null>(null)

  return (
    <div style={{ position: 'relative', marginBottom: 24 }}>
      <span className="label">VOD timeline — purple = dead time cut</span>
      <div
        style={{
          height: 32,
          background: '#1a1a1a',
          borderRadius: 4,
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid #242424',
        }}
      >
        {/* kept segments background */}
        <div style={{ position: 'absolute', inset: 0, background: '#1E3A2E' }} />

        {/* cut segments overlay */}
        {cuts.map((cut, i) => (
          <div
            key={i}
            onMouseEnter={() => setHover(cut)}
            onMouseLeave={() => setHover(null)}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${(cut.startSeconds / total) * 100}%`,
              width: `${((cut.endSeconds - cut.startSeconds) / total) * 100}%`,
              background: CUT_COLORS[cut.type] || '#9146FF',
              opacity: 0.7,
              cursor: 'pointer',
              minWidth: 2,
            }}
          />
        ))}

        {/* time labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <div
            key={p}
            style={{
              position: 'absolute',
              top: 2,
              left: `${p * 100}%`,
              transform: p === 1 ? 'translateX(-100%)' : p > 0 ? 'translateX(-50%)' : undefined,
              fontSize: 9,
              color: '#555',
              fontFamily: 'Space Mono, monospace',
              pointerEvents: 'none',
            }}
          >
            {fmtSecs(p * total)}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: '#1E3A2E' }} />
          kept
        </div>
        {Object.entries(CUT_COLORS).map(([type, color]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            {type}
          </div>
        ))}
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: '#1a1a1a',
            border: `1px solid ${CUT_COLORS[hover.type]}`,
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <span style={{ color: CUT_COLORS[hover.type], fontWeight: 700 }}>{hover.type.toUpperCase()}</span>
          <span style={{ color: '#888', margin: '0 8px' }}>
            {hover.start} → {hover.end}
          </span>
          <span style={{ color: '#ccc' }}>{hover.reason}</span>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [aggressiveness, setAggressiveness] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate')
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [activeTab, setActiveTab] = useState<'cuts' | 'chapters'>('cuts')
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const LOADING_MSGS = [
    'Fetching VOD metadata...',
    'Scanning for dead air...',
    'Identifying silent gaps...',
    'Detecting AFK segments...',
    'Analyzing energy levels...',
    'Building cut list...',
    'Generating chapter markers...',
    'Almost done...',
  ]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim() || loading) return
    setError('')
    setResult(null)
    setLoading(true)

    // Cycle loading messages
    let msgIdx = 0
    setLoadingMsg(LOADING_MSGS[0])
    timerRef.current = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADING_MSGS.length
      setLoadingMsg(LOADING_MSGS[msgIdx])
    }, 2500)

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), description, aggressiveness }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Analysis failed')
      setResult(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }

  const safe = (name: string) => name.replace(/[^a-z0-9]/gi, '_').toLowerCase()

  return (
    <main style={{ minHeight: '100vh', padding: '0 0 80px' }}>
      {/* Header bar */}
      <div
        style={{
          borderBottom: '1px solid #1a1a1a',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              background: '#9146FF',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
            }}
          >
            ✂
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>VOD Trimmer</span>
        </div>
        <span style={{ fontSize: 11, color: '#444', letterSpacing: '0.08em' }}>POWERED BY CLAUDE</span>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 24px 0' }}>

        {/* Hero */}
        {!result && !loading && (
          <div style={{ marginBottom: 40, textAlign: 'center' }} className="fade-up">
            <h1
              style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 'clamp(48px, 10vw, 80px)',
                letterSpacing: '0.04em',
                lineHeight: 1,
                margin: '0 0 12px',
                color: '#F0F0F0',
              }}
            >
              CUT THE
              <br />
              <span style={{ color: '#9146FF' }}>DEAD AIR</span>
            </h1>
            <p style={{ color: '#555', fontSize: 14, lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>
              Paste a Twitch VOD URL. Claude finds the silence, AFK time, and slow moments.
              Download a cut list for Premiere or DaVinci — no uploads, no re-encoding.
            </p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ marginBottom: 32 }} className={result ? '' : 'fade-up'}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label className="label">Twitch VOD URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.twitch.tv/videos/123456789"
                required
                disabled={loading}
              />
            </div>

            <div>
              <label className="label">Notes for Claude (optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Minecraft survival stream, ~8 hours, lots of building"
                disabled={loading}
              />
            </div>

            <div>
              <label className="label">Cut aggressiveness</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {(['conservative', 'moderate', 'aggressive'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className="btn-outline"
                    onClick={() => setAggressiveness(opt)}
                    style={{
                      borderColor: aggressiveness === opt ? '#9146FF' : '#242424',
                      color: aggressiveness === opt ? '#9146FF' : '#666',
                      background: aggressiveness === opt ? 'rgba(145,70,255,0.08)' : 'transparent',
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
                {aggressiveness === 'conservative' && '✦ Cuts silence 45s+, obvious AFK only'}
                {aggressiveness === 'moderate' && '✦ Cuts silence 15s+, low-energy moments'}
                {aggressiveness === 'aggressive' && '✦ Cuts everything slow, all filler, silence 5s+'}
              </div>
            </div>

            {error && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(255,68,68,0.08)',
                  border: '1px solid rgba(255,68,68,0.2)',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#FF6B6B',
                }}
              >
                ⚠ {error}
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={loading || !url.trim()}>
              {loading ? <LoadingDots /> : result ? 'Analyze again →' : 'Analyze VOD →'}
            </button>
          </div>
        </form>

        {/* Loading state */}
        {loading && (
          <div className="card fade-up" style={{ textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>
              <span className="spin" style={{ display: 'inline-block' }}>◌</span>
            </div>
            <div style={{ fontSize: 13, color: '#9146FF', marginBottom: 4 }}>{loadingMsg}</div>
            <div style={{ fontSize: 11, color: '#333' }}>Claude is scanning the VOD for dead time...</div>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }} className="fade-up">

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                { label: 'Dead time cut', value: `~${result.estimatedSavedMinutes}m`, color: '#39D353' },
                { label: 'Segments removed', value: String(result.cuts.length), color: '#9146FF' },
                { label: 'Chapters marked', value: String(result.chapters.length), color: '#60A5FA' },
              ].map((s) => (
                <div key={s.label} className="card" style={{ textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: 'Bebas Neue, sans-serif', letterSpacing: '0.04em' }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* VOD info */}
            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{result.vodTitle}</div>
                <div style={{ fontSize: 12, color: '#555' }}>{result.streamer} · {result.totalDuration}</div>
              </div>
              <a
                href={`https://www.twitch.tv/videos/${result.vodId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#9146FF', textDecoration: 'none' }}
              >
                View VOD ↗
              </a>
            </div>

            {/* Summary */}
            <div className="card" style={{ borderLeft: '3px solid #9146FF', paddingLeft: 16 }}>
              <div className="label">AI Summary</div>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: '#ccc' }}>{result.summary}</div>
            </div>

            {/* Timeline */}
            <div className="card">
              <Timeline cuts={result.cuts} total={result.totalDurationSeconds} />
            </div>

            {/* Tabs — Cuts / Chapters */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', borderBottom: '1px solid #242424' }}>
                {(['cuts', 'chapters'] as const).map((tab) => (
                  <button
                    key={tab}
                    className="btn-outline"
                    onClick={() => setActiveTab(tab)}
                    style={{
                      borderRadius: 0,
                      border: 'none',
                      borderBottom: activeTab === tab ? '2px solid #9146FF' : '2px solid transparent',
                      color: activeTab === tab ? '#9146FF' : '#555',
                      padding: '12px 20px',
                      fontSize: 12,
                      fontWeight: activeTab === tab ? 700 : 400,
                    }}
                  >
                    {tab === 'cuts' ? `✂ Cuts (${result.cuts.length})` : `◆ Chapters (${result.chapters.length})`}
                  </button>
                ))}
              </div>

              <div style={{ maxHeight: 320, overflowY: 'auto', padding: 16 }}>
                {activeTab === 'cuts' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {result.cuts.map((cut, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '8px 12px',
                          background: '#0C0C0C',
                          borderRadius: 6,
                          borderLeft: `3px solid ${CUT_COLORS[cut.type] || '#9146FF'}`,
                        }}
                      >
                        <div style={{ fontSize: 11, color: CUT_COLORS[cut.type], fontWeight: 700, minWidth: 80 }}>
                          {cut.type.toUpperCase()}
                        </div>
                        <div style={{ fontSize: 11, color: '#555', fontFamily: 'Space Mono', minWidth: 120 }}>
                          {cut.start} → {cut.end}
                        </div>
                        <div style={{ fontSize: 12, color: '#888', flex: 1 }}>{cut.reason}</div>
                        <div style={{ fontSize: 11, color: '#444', flexShrink: 0 }}>
                          -{fmtSecs(cut.endSeconds - cut.startSeconds)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'chapters' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {result.chapters.map((ch, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '8px 12px',
                          background: '#0C0C0C',
                          borderRadius: 6,
                        }}
                      >
                        <div style={{ fontSize: 16, minWidth: 24, textAlign: 'center' }}>
                          {CHAPTER_ICONS[ch.type] || '●'}
                        </div>
                        <div style={{ fontSize: 12, color: '#555', fontFamily: 'Space Mono', minWidth: 80 }}>
                          {ch.timestamp}
                        </div>
                        <div style={{ fontSize: 13, color: '#ddd', flex: 1 }}>{ch.title}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Downloads */}
            <div className="card">
              <div className="label" style={{ marginBottom: 12 }}>Download cut files</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[
                  {
                    label: 'EDL File',
                    desc: 'Premiere / Resolve / Avid',
                    ext: 'edl',
                    content: result.edlContent,
                    icon: '🎬',
                  },
                  {
                    label: 'Chapters',
                    desc: 'YouTube / text editor',
                    ext: 'txt',
                    content: result.chaptersTxt,
                    icon: '📍',
                  },
                  {
                    label: 'FFmpeg Script',
                    desc: 'Run locally, no upload',
                    ext: 'sh',
                    content: result.ffmpegScript,
                    icon: '⚡',
                  },
                ].map((dl) => (
                  <button
                    key={dl.ext}
                    className="btn-outline"
                    onClick={() => download(`${safe(result.vodTitle)}_${dl.ext}.${dl.ext}`, dl.content)}
                    style={{ textAlign: 'left', padding: '12px', height: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}
                  >
                    <div style={{ fontSize: 18 }}>{dl.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#ddd' }}>{dl.label}</div>
                    <div style={{ fontSize: 10, color: '#555' }}>{dl.desc}</div>
                  </button>
                ))}
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  background: '#0C0C0C',
                  borderRadius: 6,
                  fontSize: 11,
                  color: '#444',
                  lineHeight: 1.7,
                }}
              >
                <strong style={{ color: '#666' }}>EDL:</strong> Import directly into Premiere Pro or DaVinci Resolve (File → Import → EDL).
                Your original VOD file will be used as the source — no re-encoding needed.
                <br />
                <strong style={{ color: '#666' }}>FFmpeg Script:</strong> Run <code style={{ color: '#9146FF' }}>bash trim.sh your_vod.mp4</code> to
                process locally. Fast stream-copy, works on 12-hour files.
              </div>
            </div>

          </div>
        )}
      </div>
    </main>
  )
}

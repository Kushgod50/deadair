'use client'
import { useState } from 'react'

const COLORS: Record<string, string> = {
  silence: '#FF6B6B', afk: '#FFB347', filler: '#9146FF',
  technical: '#60A5FA', low_energy: '#888',
}
const ICONS: Record<string, string> = {
  stream_start: '▶', highlight: '★', game_change: '◆',
  topic_change: '●', stream_end: '■',
}

function toTS(s: number) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${sec}s`
}

function dl(name: string, content: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content]))
  a.download = name
  a.click()
}

const S = {
  card: { background: '#141414', border: '1px solid #242424', borderRadius: 10, padding: 20 } as React.CSSProperties,
  label: { fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#555', marginBottom: 6, display: 'block' },
  input: { width: '100%', background: '#0C0C0C', border: '1px solid #242424', borderRadius: 6, padding: '10px 14px', color: '#F0F0F0', fontFamily: 'Space Mono, monospace', fontSize: 13, boxSizing: 'border-box' as const, outline: 'none' },
}

export default function Page() {
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [agg, setAgg] = useState('moderate')
  const [censorEnabled, setCensorEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)
  const [tab, setTab] = useState('cuts')

  async function submit(e: any) {
    e.preventDefault()
    if (!url || loading) return
    setLoading(true); setError(''); setResult(null)
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, description: notes, aggressiveness: agg, censorEnabled }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setResult(d)
      setTab('cuts')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const safe = (s: string) => s.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  const hasMutes = result?.muteWords?.length > 0

  return (
    <main style={{ minHeight: '100vh', padding: '0 0 80px' }}>

      {/* Nav */}
      <div style={{ borderBottom: '1px solid #1a1a1a', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, background: '#9146FF', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✂</div>
          <b style={{ fontSize: 15 }}>VOD Trimmer</b>
        </div>
        <span style={{ fontSize: 11, color: '#444', letterSpacing: '0.08em' }}>POWERED BY CLAUDE</span>
      </div>

      <div style={{ maxWidth: 660, margin: '0 auto', padding: '40px 20px 0' }}>

        {/* Hero */}
        {!result && !loading && (
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h1 style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: 'clamp(52px,12vw,90px)', letterSpacing: '0.04em', lineHeight: 1, margin: '0 0 12px' }}>
              CUT THE<br /><span style={{ color: '#9146FF' }}>DEAD AIR</span>
            </h1>
            <p style={{ color: '#555', fontSize: 14, lineHeight: 1.7, maxWidth: 420, margin: '0 auto' }}>
              Paste a Twitch VOD URL. Claude finds the silence, AFK time, and slow moments.
              Download a cut list for Premiere or DaVinci — no uploads, no re-encoding.
            </p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={submit} style={{ marginBottom: 28 }}>
          <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div>
              <label style={S.label}>Twitch VOD URL</label>
              <input type="url" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://www.twitch.tv/videos/123456789"
                disabled={loading} required style={S.input} />
            </div>

            <div>
              <label style={S.label}>Notes (optional)</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Minecraft stream, ~4 hours, lots of building"
                disabled={loading} style={S.input} />
            </div>

            {/* Aggressiveness */}
            <div>
              <label style={S.label}>Cut aggressiveness</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {['conservative','moderate','aggressive'].map(o => (
                  <button key={o} type="button" onClick={() => setAgg(o)}
                    style={{ background: agg===o ? 'rgba(145,70,255,0.12)' : 'transparent', border: `1px solid ${agg===o ? '#9146FF' : '#242424'}`, borderRadius: 6, padding: '8px 4px', color: agg===o ? '#9146FF' : '#555', fontFamily: 'Space Mono, monospace', fontSize: 11, cursor: 'pointer', textTransform: 'capitalize' }}>
                    {o}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#444', marginTop: 7 }}>
                {agg === 'conservative' && '✦ Only silence 45s+, obvious AFK'}
                {agg === 'moderate' && '✦ Silence 15s+, low-energy, BRB moments'}
                {agg === 'aggressive' && '✦ Everything slow — silence 5s+, all filler'}
              </div>
            </div>

            {/* Censor toggle */}
            <div
              onClick={() => setCensorEnabled(v => !v)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: censorEnabled ? 'rgba(255,107,107,0.06)' : '#0C0C0C', border: `1px solid ${censorEnabled ? 'rgba(255,107,107,0.3)' : '#242424'}`, borderRadius: 8, cursor: 'pointer', userSelect: 'none' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: censorEnabled ? '#FF6B6B' : '#888', fontFamily: 'Space Mono, monospace' }}>
                  🔇 Mute profanity &amp; slurs
                </div>
                <div style={{ fontSize: 11, color: '#444', marginTop: 3 }}>
                  Claude flags curse words — FFmpeg script mutes them with silence
                </div>
              </div>
              {/* Toggle pill */}
              <div style={{ width: 42, height: 24, borderRadius: 12, background: censorEnabled ? '#FF6B6B' : '#242424', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 3, left: censorEnabled ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
              </div>
            </div>

            {error && (
              <div style={{ padding: '10px 14px', background: 'rgba(255,68,68,0.08)', border: '1px solid rgba(255,68,68,0.2)', borderRadius: 6, fontSize: 13, color: '#FF6B6B' }}>
                ⚠ {error}
              </div>
            )}

            <button type="submit" disabled={loading || !url}
              style={{ background: loading || !url ? '#1a1a1a' : '#9146FF', color: loading || !url ? '#444' : 'white', border: 'none', borderRadius: 7, padding: '12px 20px', fontFamily: 'Space Mono, monospace', fontWeight: 700, fontSize: 13, cursor: loading || !url ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Analyzing...' : result ? 'Analyze again →' : 'Analyze VOD →'}
            </button>
          </div>
        </form>

        {/* Loading */}
        {loading && (
          <div style={{ ...S.card, textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ fontSize: 28, marginBottom: 12, animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</div>
            <div style={{ fontSize: 13, color: '#9146FF' }}>
              {censorEnabled ? 'Scanning for dead air and profanity...' : 'Claude is scanning for dead air...'}
            </div>
            <div style={{ fontSize: 11, color: '#333', marginTop: 4 }}>This takes ~10–20 seconds</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: hasMutes ? 'repeat(4,1fr)' : 'repeat(3,1fr)', gap: 10 }}>
              {[
                { label: 'Time Saved', value: `~${result.estimatedSavedMinutes}m`, color: '#39D353' },
                { label: 'Cuts Made', value: String(result.cuts.length), color: '#9146FF' },
                { label: 'Chapters', value: String(result.chapters.length), color: '#60A5FA' },
                ...(hasMutes ? [{ label: 'Words Muted', value: String(result.muteWords.length), color: '#FF6B6B' }] : []),
              ].map(s => (
                <div key={s.label} style={{ ...S.card, padding: '14px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 30, fontWeight: 700, color: s.color, fontFamily: 'Bebas Neue, sans-serif', letterSpacing: '0.04em' }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* VOD info */}
            <div style={{ ...S.card, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{result.vodTitle}</div>
                <div style={{ fontSize: 12, color: '#555' }}>{result.streamer} · {result.totalDuration}</div>
              </div>
              <a href={`https://www.twitch.tv/videos/${result.vodId}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#9146FF', textDecoration: 'none' }}>View VOD ↗</a>
            </div>

            {/* Summary */}
            <div style={{ ...S.card, padding: '14px 16px', borderLeft: '3px solid #9146FF' }}>
              <span style={S.label}>AI Summary</span>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: '#ccc' }}>{result.summary}</div>
            </div>

            {/* Timeline */}
            <div style={{ ...S.card, padding: '14px 16px' }}>
              <span style={S.label}>VOD Timeline — hover a segment for details</span>
              <div style={{ height: 28, background: '#1E3A2E', borderRadius: 4, position: 'relative', overflow: 'hidden', border: '1px solid #1a1a1a' }}>
                {result.cuts.map((c: any, i: number) => (
                  <div key={i} title={`${c.start}→${c.end}: ${c.reason}`}
                    style={{ position: 'absolute', top: 0, bottom: 0, left: `${(c.startSeconds/result.totalDurationSeconds)*100}%`, width: `${Math.max(((c.endSeconds-c.startSeconds)/result.totalDurationSeconds)*100, 0.3)}%`, background: COLORS[c.type]||'#9146FF', opacity: 0.75, cursor: 'pointer' }} />
                ))}
                {/* Mute word markers */}
                {result.muteWords?.map((w: any, i: number) => (
                  <div key={`m${i}`} title={`Muted at ${w.timestamp}`}
                    style={{ position: 'absolute', top: 0, bottom: 0, width: 3, left: `${(w.startSeconds/result.totalDurationSeconds)*100}%`, background: '#FF6B6B', zIndex: 2 }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 10, background: '#1E3A2E', display: 'inline-block', borderRadius: 2 }}/>kept
                </span>
                {Object.entries(COLORS).map(([k,v]) => (
                  <span key={k} style={{ fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, background: v, display: 'inline-block', borderRadius: 2 }}/>{k}
                  </span>
                ))}
                {hasMutes && (
                  <span style={{ fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 3, height: 10, background: '#FF6B6B', display: 'inline-block' }}/>muted word
                  </span>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ background: '#141414', border: '1px solid #242424', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', overflowX: 'auto' }}>
                {[
                  { id: 'cuts', label: `✂ Cuts (${result.cuts.length})` },
                  { id: 'chapters', label: `◆ Chapters (${result.chapters.length})` },
                  ...(hasMutes ? [{ id: 'mutes', label: `🔇 Muted (${result.muteWords.length})` }] : []),
                ].map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    style={{ background: 'transparent', border: 'none', borderBottom: tab===t.id ? '2px solid #9146FF' : '2px solid transparent', padding: '11px 18px', color: tab===t.id ? '#9146FF' : '#555', fontFamily: 'Space Mono, monospace', fontSize: 12, cursor: 'pointer', fontWeight: tab===t.id ? 700 : 400, whiteSpace: 'nowrap' }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto', padding: 14 }}>
                {tab === 'cuts' && result.cuts.map((c: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#0C0C0C', borderRadius: 5, marginBottom: 6, borderLeft: `3px solid ${COLORS[c.type]||'#9146FF'}` }}>
                    <span style={{ fontSize: 10, color: COLORS[c.type], fontWeight: 700, minWidth: 75, textTransform: 'uppercase' }}>{c.type}</span>
                    <span style={{ fontSize: 11, color: '#555', minWidth: 110 }}>{c.start}→{c.end}</span>
                    <span style={{ fontSize: 12, color: '#888', flex: 1 }}>{c.reason}</span>
                    <span style={{ fontSize: 11, color: '#444' }}>-{toTS(c.endSeconds-c.startSeconds)}</span>
                  </div>
                ))}
                {tab === 'chapters' && result.chapters.map((c: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#0C0C0C', borderRadius: 5, marginBottom: 6 }}>
                    <span style={{ fontSize: 16 }}>{ICONS[c.type]||'●'}</span>
                    <span style={{ fontSize: 11, color: '#555', minWidth: 75 }}>{c.timestamp}</span>
                    <span style={{ fontSize: 13, color: '#ddd' }}>{c.title}</span>
                  </div>
                ))}
                {tab === 'mutes' && result.muteWords?.map((w: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#0C0C0C', borderRadius: 5, marginBottom: 6, borderLeft: '3px solid #FF6B6B' }}>
                    <span style={{ fontSize: 18 }}>🔇</span>
                    <span style={{ fontSize: 11, color: '#555', minWidth: 75 }}>{w.timestamp}</span>
                    <span style={{ fontSize: 12, color: '#888' }}>Profanity flagged — {(w.endSeconds - w.startSeconds).toFixed(1)}s muted</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Downloads */}
            <div style={{ ...S.card, padding: '14px 16px' }}>
              <span style={S.label}>Download cut files</span>
              <div style={{ display: 'grid', gridTemplateColumns: hasMutes ? 'repeat(4,1fr)' : 'repeat(3,1fr)', gap: 10 }}>
                {[
                  { label: 'EDL File', desc: 'Premiere / DaVinci', ext: 'edl', content: result.edlContent, icon: '🎬' },
                  { label: 'Chapters', desc: 'YouTube / text', ext: 'txt', content: result.chaptersTxt, icon: '📍' },
                  { label: 'Trim + Mute', desc: 'FFmpeg — all-in-one', ext: 'sh', content: result.ffmpegScript, icon: '⚡' },
                  ...(hasMutes && result.muteScript ? [{ label: 'Mute Only', desc: 'Apply to trimmed file', ext: 'sh', content: result.muteScript, icon: '🔇' }] : []),
                ].map((d, i) => (
                  <button key={i} onClick={() => dl(`${safe(result.vodTitle)}_${d.ext}${i === 3 ? '_mute' : ''}.${d.ext}`, d.content)}
                    style={{ background: 'transparent', border: '1px solid #242424', borderRadius: 7, padding: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 18 }}>{d.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#ddd', fontFamily: 'Space Mono, monospace' }}>{d.label}</span>
                    <span style={{ fontSize: 10, color: '#555', fontFamily: 'Space Mono, monospace' }}>{d.desc}</span>
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#0C0C0C', borderRadius: 6, fontSize: 11, color: '#444', lineHeight: 1.8 }}>
                <b style={{ color: '#666' }}>EDL:</b> File → Import → EDL in Premiere or DaVinci. Uses your original VOD, no re-encoding.{'  '}
                <b style={{ color: '#666' }}>Trim + Mute script:</b> <code style={{ color: '#9146FF' }}>bash trim.sh vod.mp4</code> — cuts dead time and mutes flagged words in one pass.{'  '}
                {hasMutes && <><b style={{ color: '#666' }}>Mute Only:</b> Run on an already-trimmed file if you used the EDL in your editor.</>}
              </div>
            </div>

          </div>
        )}
      </div>
    </main>
  )
}

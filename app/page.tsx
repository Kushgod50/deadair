'use client'
import { useState, useRef } from 'react'

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:3001'

const COLORS: Record<string, string> = {
  silence: '#FF6B6B', afk: '#FFB347', filler: '#9146FF',
  technical: '#60A5FA', low_energy: '#555',
  cut_for_pacing: '#E879F9', not_highlight_material: '#374151',
}
const ICONS: Record<string, string> = {
  stream_start: '▶', highlight: '★', game_change: '◆',
  topic_change: '●', stream_end: '■', hook: '🎣', peak: '🔥', payoff: '🏆',
}

function toTS(s: number) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${sec}s`
}
function toTC(s: number) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}
function dl(name: string, content: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content])); a.download = name; a.click()
}
function buildEDL(cuts: any[], title: string, total: number) {
  const sorted = [...cuts].sort((a,b) => a.startSeconds - b.startSeconds)
  const keep: {start:number,end:number}[] = []; let cur = 0
  for (const c of sorted) { if (c.startSeconds > cur+1) keep.push({start:cur,end:c.startSeconds}); cur = c.endSeconds }
  if (cur < total-1) keep.push({start:cur,end:total})
  const lines = [`TITLE: ${title}`, 'FCM: NON-DROP FRAME', '']; let rec = 0
  keep.forEach((seg,i) => { const dur=seg.end-seg.start; const tc=(s:number)=>toTC(s)+':00'; lines.push(`${String(i+1).padStart(3,'0')}  AX       V     C        ${tc(seg.start)} ${tc(seg.end)} ${tc(rec)} ${tc(rec+dur)}`); lines.push(`* FROM CLIP NAME: ${title}`,''); rec+=dur })
  return lines.join('\n')
}
function buildChaptersTxt(chapters: any[], cuts: any[]) {
  const lines = ['CHAPTERS\n']
  for (const ch of chapters) {
    let offset = 0
    for (const c of cuts) { if (c.endSeconds <= ch.seconds) offset += c.endSeconds - c.startSeconds; else if (c.startSeconds < ch.seconds) { offset += ch.seconds - c.startSeconds; break } }
    lines.push(`${toTC(Math.max(0, ch.seconds-offset))}  ${ch.title}`)
  }
  return lines.join('\n')
}

const S = {
  card: { background: '#141414', border: '1px solid #242424', borderRadius: 10, padding: 20 } as React.CSSProperties,
  label: { fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#555', marginBottom: 6, display: 'block' },
  input: { width: '100%', background: '#0C0C0C', border: '1px solid #242424', borderRadius: 6, padding: '10px 14px', color: '#F0F0F0', fontFamily: 'Space Mono, monospace', fontSize: 13, boxSizing: 'border-box' as const, outline: 'none' },
  btn: (active: boolean, color = '#9146FF') => ({
    background: active ? `${color}22` : 'transparent',
    border: `1px solid ${active ? color : '#242424'}`,
    borderRadius: 6, padding: '8px 4px',
    color: active ? color : '#555',
    fontFamily: 'Space Mono, monospace', fontSize: 11, cursor: 'pointer',
  } as React.CSSProperties),
}

const PHASE_ICONS: Record<string, string> = {
  downloading: '⬇', trimming: '✂', merging: '🔗',
  censoring: '🔇', finalizing: '✨', done: '✅', error: '⚠',
}

export default function Page() {
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [agg, setAgg] = useState('moderate')
  const [censorEnabled, setCensorEnabled] = useState(false)
  const [mode, setMode] = useState<'trim' | 'highlight'>('trim')
  const [targetMinutes, setTargetMinutes] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)
  const [tab, setTab] = useState('cuts')
  const [processing, setProcessing] = useState(false)
  const [processJob, setProcessJob] = useState<any>(null)
  const pollRef = useRef<any>(null)

  async function submit(e: any) {
    e.preventDefault()
    if (!url || loading) return
    if (mode === 'highlight' && !targetMinutes) { setError('Please choose a target length for the highlight reel'); return }
    setLoading(true); setError(''); setResult(null); setProcessJob(null)
    try {
      const r = await fetch(`${WORKER_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, description: notes, aggressiveness: agg, censorEnabled, mode, targetMinutes }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setResult(d); setTab('cuts')
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function startProcessing() {
    if (!result || processing) return
    setProcessing(true)
    setProcessJob({ status: 'queued', phase: 'Starting...', progress: 0 })
    try {
      const r = await fetch(`${WORKER_URL}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, cuts: result.cuts, muteWords: result.muteWords || [], vodTitle: result.vodTitle }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      pollRef.current = setInterval(async () => {
        const s = await fetch(`${WORKER_URL}/api/status/${d.jobId}`)
        const job = await s.json()
        setProcessJob({ ...job, jobId: d.jobId })
        if (job.status === 'done' || job.status === 'error') { clearInterval(pollRef.current); setProcessing(false) }
      }, 2000)
    } catch (e: any) { setError(e.message); setProcessing(false) }
  }

  const safe = (s: string) => s?.replace(/[^a-z0-9]/gi,'_').toLowerCase() || 'vod'
  const hasMutes = result?.muteWords?.length > 0
  const jobDone = processJob?.status === 'done'
  const jobError = processJob?.status === 'error'
  const isHighlight = result?.mode === 'highlight'

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

        {!result && !loading && (
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h1 style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: 'clamp(52px,12vw,90px)', letterSpacing: '0.04em', lineHeight: 1, margin: '0 0 12px' }}>
              CUT THE<br /><span style={{ color: '#9146FF' }}>DEAD AIR</span>
            </h1>
            <p style={{ color: '#555', fontSize: 14, lineHeight: 1.7, maxWidth: 440, margin: '0 auto' }}>
              Trim dead air from your VOD — or let Claude build a highlight reel with proper story structure, peak moments, and pacing.
            </p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={submit} style={{ marginBottom: 28 }}>
          <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 18 }}>

            <div>
              <label style={S.label}>Twitch VOD URL</label>
              <input type="url" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://www.twitch.tv/videos/123456789"
                disabled={loading || processing} required style={S.input} />
            </div>

            <div>
              <label style={S.label}>Stream notes (optional but helps Claude a lot)</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Valorant ranked stream, won 3 games, big clutch at 2hr mark"
                disabled={loading || processing} style={S.input} />
            </div>

            {/* Mode selector */}
            <div>
              <label style={S.label}>What do you want?</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button type="button" onClick={() => { setMode('trim'); setTargetMinutes(null) }}
                  style={{ ...S.btn(mode==='trim'), padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', textAlign: 'left' }}>
                  <span style={{ fontSize: 18 }}>✂</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: mode==='trim' ? '#9146FF' : '#888' }}>Remove Dead Air</span>
                  <span style={{ fontSize: 10, color: '#444', lineHeight: 1.4 }}>Cut silence, AFK, and slow moments. Keep the full stream, just tighter.</span>
                </button>
                <button type="button" onClick={() => setMode('highlight')}
                  style={{ ...S.btn(mode==='highlight', '#F59E0B'), padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', textAlign: 'left' }}>
                  <span style={{ fontSize: 18 }}>🔥</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: mode==='highlight' ? '#F59E0B' : '#888' }}>Highlight Reel</span>
                  <span style={{ fontSize: 10, color: '#444', lineHeight: 1.4 }}>Claude picks the best moments and builds a story arc. Target length you choose.</span>
                </button>
              </div>
            </div>

            {/* Target length — only shown in highlight mode */}
            {mode === 'highlight' && (
              <div>
                <label style={S.label}>Target length</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {[15, 30, 45, 60].map(m => (
                    <button key={m} type="button" onClick={() => setTargetMinutes(m)}
                      style={{ ...S.btn(targetMinutes===m, '#F59E0B'), padding: '10px 4px', textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontFamily: 'Bebas Neue, sans-serif', letterSpacing: '0.04em', color: targetMinutes===m ? '#F59E0B' : '#666' }}>{m}m</div>
                      <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>
                        {m === 15 && 'Quick hit'}
                        {m === 30 && 'Standard'}
                        {m === 45 && 'Extended'}
                        {m === 60 && 'Full hour'}
                      </div>
                    </button>
                  ))}
                </div>
                {targetMinutes && (
                  <div style={{ fontSize: 11, color: '#666', marginTop: 8, padding: '8px 12px', background: '#0C0C0C', borderRadius: 6 }}>
                    🎬 Claude will apply a <b style={{ color: '#F59E0B' }}>hook → rising action → peak moments → payoff</b> structure, targeting ~{targetMinutes} minutes of the best content from your stream.
                  </div>
                )}
              </div>
            )}

            {/* Aggressiveness — only in trim mode */}
            {mode === 'trim' && (
              <div>
                <label style={S.label}>Cut aggressiveness</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {['conservative','moderate','aggressive'].map(o => (
                    <button key={o} type="button" onClick={() => setAgg(o)} disabled={loading || processing}
                      style={{ ...S.btn(agg===o), padding: '8px 4px', textTransform: 'capitalize' as const }}>
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
            )}

            {/* Censor toggle */}
            <div onClick={() => !loading && !processing && setCensorEnabled(v => !v)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: censorEnabled ? 'rgba(255,107,107,0.06)' : '#0C0C0C', border: `1px solid ${censorEnabled ? 'rgba(255,107,107,0.3)' : '#242424'}`, borderRadius: 8, cursor: 'pointer', userSelect: 'none' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: censorEnabled ? '#FF6B6B' : '#888', fontFamily: 'Space Mono, monospace' }}>🔇 Mute profanity &amp; slurs</div>
                <div style={{ fontSize: 11, color: '#444', marginTop: 3 }}>Claude flags curse words — silenced in the output MP4</div>
              </div>
              <div style={{ width: 42, height: 24, borderRadius: 12, background: censorEnabled ? '#FF6B6B' : '#242424', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 3, left: censorEnabled ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
              </div>
            </div>

            {error && (
              <div style={{ padding: '10px 14px', background: 'rgba(255,68,68,0.08)', border: '1px solid rgba(255,68,68,0.2)', borderRadius: 6, fontSize: 13, color: '#FF6B6B' }}>⚠ {error}</div>
            )}

            <button type="submit" disabled={loading || processing || !url}
              style={{ background: loading || processing || !url ? '#1a1a1a' : mode === 'highlight' ? '#D97706' : '#9146FF', color: loading || processing || !url ? '#444' : 'white', border: 'none', borderRadius: 7, padding: '13px 20px', fontFamily: 'Space Mono, monospace', fontWeight: 700, fontSize: 13, cursor: loading || processing || !url ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Analyzing...' : mode === 'highlight' ? `🔥 Build ${targetMinutes ? targetMinutes+'m ' : ''}Highlight Reel →` : '✂ Analyze & Trim →'}
            </button>
          </div>
        </form>

        {/* Loading */}
        {loading && (
          <div style={{ ...S.card, textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ fontSize: 28, marginBottom: 12, animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</div>
            <div style={{ fontSize: 13, color: mode === 'highlight' ? '#F59E0B' : '#9146FF' }}>
              {mode === 'highlight' ? 'Claude is building your highlight reel story arc...' : 'Claude is scanning for dead air...'}
            </div>
            <div style={{ fontSize: 11, color: '#333', marginTop: 4 }}>~10–20 seconds</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Highlight reel badge */}
            {isHighlight && (
              <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>🎬</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>Highlight Reel — {result.targetMinutes}min target</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Story arc structure applied · Hook → Rising Action → Peak Moments → Payoff</div>
                </div>
              </div>
            )}

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: hasMutes ? 'repeat(4,1fr)' : 'repeat(3,1fr)', gap: 10 }}>
              {[
                { label: isHighlight ? 'Output Length' : 'Time Saved', value: isHighlight ? `~${result.estimatedOutputMinutes || result.targetMinutes}m` : `~${result.estimatedSavedMinutes}m`, color: isHighlight ? '#F59E0B' : '#39D353' },
                { label: 'Segments', value: String(result.cuts.length), color: '#9146FF' },
                { label: 'Chapters', value: String(result.chapters.length), color: '#60A5FA' },
                ...(hasMutes ? [{ label: 'Words Muted', value: String(result.muteWords.length), color: '#FF6B6B' }] : []),
              ].map(s => (
                <div key={s.label} style={{ ...S.card, padding: '14px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: 'Bebas Neue, sans-serif', letterSpacing: '0.04em' }}>{s.value}</div>
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
            <div style={{ ...S.card, padding: '14px 16px', borderLeft: `3px solid ${isHighlight ? '#F59E0B' : '#9146FF'}` }}>
              <span style={S.label}>{isHighlight ? 'Highlight Reel Plan' : 'AI Summary'}</span>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: '#ccc' }}>{result.summary}</div>
            </div>

            {/* Timeline */}
            <div style={{ ...S.card, padding: '14px 16px' }}>
              <span style={S.label}>VOD Timeline — {isHighlight ? 'gold = kept for highlight' : 'green = kept'}</span>
              <div style={{ height: 32, background: isHighlight ? '#1a1400' : '#1E3A2E', borderRadius: 4, position: 'relative', overflow: 'hidden', border: '1px solid #1a1a1a' }}>
                {result.cuts.map((c: any, i: number) => (
                  <div key={i} title={`${c.start}→${c.end}: ${c.reason}`}
                    style={{ position: 'absolute', top: 0, bottom: 0, left: `${(c.startSeconds/result.totalDurationSeconds)*100}%`, width: `${Math.max(((c.endSeconds-c.startSeconds)/result.totalDurationSeconds)*100, 0.2)}%`, background: COLORS[c.type]||'#555', opacity: 0.8, cursor: 'pointer' }} />
                ))}
                {/* Chapter markers */}
                {result.chapters.map((ch: any, i: number) => (
                  <div key={`ch${i}`} title={ch.title}
                    style={{ position: 'absolute', top: 0, bottom: 0, width: 2, left: `${(ch.seconds/result.totalDurationSeconds)*100}%`, background: isHighlight ? '#F59E0B' : '#9146FF', zIndex: 2, opacity: 0.8 }} />
                ))}
                {result.muteWords?.map((w: any, i: number) => (
                  <div key={`m${i}`} title={`Muted at ${w.timestamp}`}
                    style={{ position: 'absolute', top: 0, bottom: 0, width: 2, left: `${(w.startSeconds/result.totalDurationSeconds)*100}%`, background: '#FF6B6B', zIndex: 3 }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 10, background: isHighlight ? '#1a1400' : '#1E3A2E', display: 'inline-block', borderRadius: 2 }}/>kept
                </span>
                {Object.entries(COLORS).filter(([k]) => result.cuts.some((c:any) => c.type === k)).map(([k,v]) => (
                  <span key={k} style={{ fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, background: v, display: 'inline-block', borderRadius: 2 }}/>{k.replace(/_/g,' ')}
                  </span>
                ))}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ background: '#141414', border: '1px solid #242424', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', overflowX: 'auto' }}>
                {[
                  { id: 'cuts', label: `✂ ${isHighlight ? 'Cuts' : 'Cuts'} (${result.cuts.length})` },
                  { id: 'chapters', label: `◆ Chapters (${result.chapters.length})` },
                  ...(hasMutes ? [{ id: 'mutes', label: `🔇 Muted (${result.muteWords.length})` }] : []),
                ].map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    style={{ background: 'transparent', border: 'none', borderBottom: tab===t.id ? `2px solid ${isHighlight ? '#F59E0B' : '#9146FF'}` : '2px solid transparent', padding: '11px 18px', color: tab===t.id ? (isHighlight ? '#F59E0B' : '#9146FF') : '#555', fontFamily: 'Space Mono, monospace', fontSize: 12, cursor: 'pointer', fontWeight: tab===t.id ? 700 : 400, whiteSpace: 'nowrap' }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto', padding: 14 }}>
                {tab === 'cuts' && result.cuts.map((c: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#0C0C0C', borderRadius: 5, marginBottom: 6, borderLeft: `3px solid ${COLORS[c.type]||'#555'}` }}>
                    <span style={{ fontSize: 10, color: COLORS[c.type], fontWeight: 700, minWidth: 80, textTransform: 'uppercase' }}>{c.type?.replace(/_/g,' ')}</span>
                    <span style={{ fontSize: 11, color: '#555', minWidth: 110 }}>{c.start}→{c.end}</span>
                    <span style={{ fontSize: 12, color: '#888', flex: 1 }}>{c.reason}</span>
                    <span style={{ fontSize: 11, color: '#444' }}>-{toTS(c.endSeconds-c.startSeconds)}</span>
                  </div>
                ))}
                {tab === 'chapters' && result.chapters.map((c: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#0C0C0C', borderRadius: 5, marginBottom: 6 }}>
                    <span style={{ fontSize: 16 }}>{ICONS[c.type]||'●'}</span>
                    <span style={{ fontSize: 11, color: '#555', minWidth: 75 }}>{c.timestamp}</span>
                    <span style={{ fontSize: 13, color: '#ddd', flex: 1 }}>{c.title}</span>
                    <span style={{ fontSize: 10, color: '#444', padding: '2px 6px', background: '#1a1a1a', borderRadius: 3 }}>{c.type}</span>
                  </div>
                ))}
                {tab === 'mutes' && result.muteWords?.map((w: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#0C0C0C', borderRadius: 5, marginBottom: 6, borderLeft: '3px solid #FF6B6B' }}>
                    <span style={{ fontSize: 18 }}>🔇</span>
                    <span style={{ fontSize: 11, color: '#555', minWidth: 75 }}>{w.timestamp}</span>
                    <span style={{ fontSize: 12, color: '#888' }}>Flagged — {(w.endSeconds-w.startSeconds).toFixed(1)}s muted</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Download MP4 */}
            <div style={{ ...S.card, padding: '20px' }}>
              <span style={S.label}>Get your {isHighlight ? 'highlight reel' : 'trimmed video'} MP4</span>

              {!processJob && (
                <>
                  <div style={{ fontSize: 13, color: '#888', marginBottom: 14, lineHeight: 1.7 }}>
                    {isHighlight
                      ? `The worker will download your VOD, extract the ${result.cuts.length} best segments using Claude's story arc plan, ${hasMutes ? 'mute flagged words, ' : ''}and deliver a ~${result.targetMinutes}min highlight reel MP4 with chapter markers.`
                      : `The worker will download your VOD, cut ${result.cuts.length} dead segments, ${hasMutes ? 'mute flagged words, ' : ''}and add chapter markers.`
                    }
                  </div>
                  <div style={{ fontSize: 11, color: '#444', marginBottom: 14, padding: '8px 12px', background: '#0C0C0C', borderRadius: 6 }}>
                    ⏱ Est. time: ~{Math.max(2, Math.round(result.totalDurationSeconds/300))}–{Math.max(5, Math.round(result.totalDurationSeconds/120))} min
                  </div>
                  <button onClick={startProcessing}
                    style={{ background: isHighlight ? '#D97706' : '#9146FF', color: 'white', border: 'none', borderRadius: 7, padding: '12px 20px', fontFamily: 'Space Mono, monospace', fontWeight: 700, fontSize: 13, cursor: 'pointer', width: '100%' }}>
                    {isHighlight ? '🔥 Generate Highlight Reel MP4' : '⬇ Generate Trimmed MP4'}
                  </button>
                </>
              )}

              {processJob && !jobDone && !jobError && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 20 }}>{PHASE_ICONS[processJob.status] || '⚙'}</span>
                    <span style={{ fontSize: 13, color: '#ccc' }}>{processJob.phase}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: isHighlight ? '#F59E0B' : '#9146FF', fontFamily: 'Space Mono, monospace' }}>{processJob.progress}%</span>
                  </div>
                  <div style={{ height: 6, background: '#0C0C0C', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: isHighlight ? 'linear-gradient(90deg,#B45309,#F59E0B)' : 'linear-gradient(90deg,#7C3AED,#9146FF)', borderRadius: 3, width: `${processJob.progress}%`, transition: 'width 0.5s' }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
                    {processJob.status === 'downloading' && 'Downloading VOD from Twitch — longest step for big streams'}
                    {processJob.status === 'trimming' && 'Cutting with FFmpeg stream copy — no re-encode, very fast'}
                    {processJob.status === 'merging' && 'Stitching segments together'}
                    {processJob.status === 'censoring' && 'Muting flagged words in audio'}
                    {processJob.status === 'finalizing' && 'Embedding chapter markers into MP4'}
                  </div>
                </div>
              )}

              {jobDone && (
                <div>
                  <div style={{ fontSize: 13, color: '#39D353', marginBottom: 4 }}>✅ Ready! {processJob.fileSizeMB && `(${processJob.fileSizeMB} MB)`}</div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 14 }}>Chapters are embedded — open in Premiere, DaVinci, or VLC to see markers.</div>
                  <a href={`${WORKER_URL}/api/download/${processJob.jobId}`} download
                    style={{ display: 'block', background: '#39D353', color: '#0C0C0C', border: 'none', borderRadius: 7, padding: '12px 20px', fontFamily: 'Space Mono, monospace', fontWeight: 700, fontSize: 13, cursor: 'pointer', width: '100%', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' as const }}>
                    ⬇ Download {safe(result.vodTitle)}_trimmed.mp4
                  </a>
                  <div style={{ fontSize: 11, color: '#333', marginTop: 8 }}>File deleted from server after download.</div>
                </div>
              )}

              {jobError && (
                <div style={{ padding: '10px 14px', background: 'rgba(255,68,68,0.08)', border: '1px solid rgba(255,68,68,0.2)', borderRadius: 6, fontSize: 13, color: '#FF6B6B' }}>
                  ⚠ {processJob.error || 'Processing failed.'}
                  <button onClick={() => { setProcessJob(null); setProcessing(false) }}
                    style={{ display: 'block', marginTop: 8, background: 'transparent', border: '1px solid #FF6B6B', color: '#FF6B6B', borderRadius: 5, padding: '6px 12px', fontFamily: 'Space Mono, monospace', fontSize: 11, cursor: 'pointer' }}>
                    Try again
                  </button>
                </div>
              )}
            </div>

            {/* Text file downloads */}
            <details style={{ ...S.card, padding: '14px 16px' }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#555', fontFamily: 'Space Mono, monospace', userSelect: 'none' }}>
                Also: EDL &amp; Chapter text files (for editing in Premiere/DaVinci)
              </summary>
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { label: 'EDL File', desc: 'Premiere / DaVinci', ext: 'edl', content: buildEDL(result.cuts, result.vodTitle, result.totalDurationSeconds), icon: '🎬' },
                  { label: 'Chapters', desc: 'YouTube timestamps', ext: 'txt', content: buildChaptersTxt(result.chapters, result.cuts), icon: '📍' },
                ].map((d,i) => (
                  <button key={i} onClick={() => dl(`${safe(result.vodTitle)}.${d.ext}`, d.content)}
                    style={{ background: 'transparent', border: '1px solid #242424', borderRadius: 7, padding: 12, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 16 }}>{d.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#ddd', fontFamily: 'Space Mono, monospace' }}>{d.label}</span>
                    <span style={{ fontSize: 10, color: '#555', fontFamily: 'Space Mono, monospace' }}>{d.desc}</span>
                  </button>
                ))}
              </div>
            </details>

          </div>
        )}
      </div>
    </main>
  )
}

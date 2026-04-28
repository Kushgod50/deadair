import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const maxDuration = 60

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const GUIDES = {
  conservative: 'Only cut silences longer than 45 seconds and clear AFK moments.',
  moderate: 'Cut silences over 15s, AFK/BRB periods, loading screens, low-energy segments.',
  aggressive: 'Cut everything slow: silence over 5s, all filler, repetitive content.',
}

function toTC(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

function toTC_EDL(s: number) { return toTC(s) + ':00' }

function buildEDL(cuts: any[], title: string, total: number) {
  const sorted = [...cuts].sort((a, b) => a.startSeconds - b.startSeconds)
  const keep: {start:number,end:number}[] = []
  let cur = 0
  for (const c of sorted) {
    if (c.startSeconds > cur + 1) keep.push({ start: cur, end: c.startSeconds })
    cur = c.endSeconds
  }
  if (cur < total - 1) keep.push({ start: cur, end: total })
  const lines = [`TITLE: ${title}`, 'FCM: NON-DROP FRAME', '']
  let rec = 0
  keep.forEach((seg, i) => {
    const dur = seg.end - seg.start
    lines.push(`${String(i+1).padStart(3,'0')}  AX       V     C        ${toTC_EDL(seg.start)} ${toTC_EDL(seg.end)} ${toTC_EDL(rec)} ${toTC_EDL(rec+dur)}`)
    lines.push(`* FROM CLIP NAME: ${title}`)
    lines.push('')
    rec += dur
  })
  return lines.join('\n')
}

function buildChapters(chapters: any[], cuts: any[]) {
  const lines = ['CHAPTERS\n']
  for (const ch of chapters) {
    let offset = 0
    for (const c of cuts) {
      if (c.endSeconds <= ch.seconds) offset += c.endSeconds - c.startSeconds
      else if (c.startSeconds < ch.seconds) { offset += ch.seconds - c.startSeconds; break }
    }
    const t = Math.max(0, ch.seconds - offset)
    lines.push(`${toTC(t)}  ${ch.title}`)
  }
  lines.push('\n--- Original VOD timestamps ---')
  for (const ch of chapters) lines.push(`${ch.timestamp}  ${ch.title}`)
  return lines.join('\n')
}

function buildFFmpeg(cuts: any[], total: number, title: string) {
  const sorted = [...cuts].sort((a, b) => a.startSeconds - b.startSeconds)
  const keep: {start:number,end:number}[] = []
  let cur = 0
  for (const c of sorted) {
    if (c.startSeconds > cur + 1) keep.push({ start: cur, end: c.startSeconds })
    cur = c.endSeconds
  }
  if (cur < total - 1) keep.push({ start: cur, end: total })
  const lines = ['#!/bin/bash', `# ${title}`, '# Usage: bash trim.sh your_vod.mp4', 'INPUT="${1:-input.mp4}"', 'mkdir -p segs']
  keep.forEach((seg, i) => {
    const p = String(i).padStart(3,'0')
    lines.push(`ffmpeg -y -ss ${seg.start} -i "$INPUT" -t ${seg.end - seg.start} -c copy -avoid_negative_ts 1 segs/${p}.ts`)
  })
  const list = keep.map((_,i) => `file segs/${String(i).padStart(3,'0')}.ts`).join('\\n')
  lines.push(`printf '${list}' > list.txt`)
  lines.push('ffmpeg -y -f concat -safe 0 -i list.txt -c copy output.mp4')
  lines.push('echo "Done: output.mp4"')
  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const url = String(body.url || '')
    const description = String(body.description || '')
    const agg = String(body.aggressiveness || 'moderate')
    const guide = agg === 'conservative' ? GUIDES.conservative : agg === 'aggressive' ? GUIDES.aggressive : GUIDES.moderate

    if (!url) return NextResponse.json({ error: 'Missing URL' }, { status: 400 })
    const match = url.match(/twitch\.tv\/videos\/(\d+)/)
    if (!match) return NextResponse.json({ error: 'Invalid Twitch VOD URL' }, { status: 400 })
    const vodId = match[1]

    const prompt = `Analyze this Twitch VOD for dead time to cut.

VOD: ${url}
${description ? `Notes: ${description}` : ''}
Aggressiveness: ${agg} — ${guide}

Return ONLY valid JSON (no markdown), this exact shape:
{
  "vodTitle": "string",
  "streamer": "string",
  "totalDuration": "HH:MM:SS",
  "totalDurationSeconds": number,
  "chapters": [{"timestamp":"HH:MM:SS","seconds":number,"title":"string","type":"stream_start|highlight|game_change|topic_change|stream_end"}],
  "cuts": [{"start":"HH:MM:SS","end":"HH:MM:SS","startSeconds":number,"endSeconds":number,"reason":"string","type":"silence|afk|filler|technical|low_energy"}],
  "estimatedSavedMinutes": number,
  "summary": "string"
}`

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = resp.content[0].type === 'text' ? resp.content[0].text : ''
    const parsed = JSON.parse(raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim())
    parsed.cuts.sort((a: any, b: any) => a.startSeconds - b.startSeconds)

    return NextResponse.json({
      vodId,
      ...parsed,
      edlContent: buildEDL(parsed.cuts, parsed.vodTitle, parsed.totalDurationSeconds),
      chaptersTxt: buildChapters(parsed.chapters, parsed.cuts),
      ffmpegScript: buildFFmpeg(parsed.cuts, parsed.totalDurationSeconds, parsed.vodTitle),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 })
  }
}

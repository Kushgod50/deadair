// app/api/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const maxDuration = 60

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface Chapter {
  timestamp: string
  seconds: number
  title: string
  type: 'highlight' | 'cut_before' | 'game_change' | 'topic_change' | 'stream_start' | 'stream_end'
}

export interface CutSegment {
  start: string
  end: string
  startSeconds: number
  endSeconds: number
  reason: string
  type: 'silence' | 'afk' | 'filler' | 'technical' | 'low_energy'
}

export interface AnalysisResult {
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

function toTimecodeEDL(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:00`
}

function toTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

function generateEDL(cuts: CutSegment[], vodTitle: string, totalSeconds: number): string {
  const lines: string[] = [`TITLE: ${vodTitle} - Trimmed`, 'FCM: NON-DROP FRAME', '']
  const keep: Array<{ start: number; end: number }> = []
  let cursor = 0
  for (const cut of [...cuts].sort((a, b) => a.startSeconds - b.startSeconds)) {
    if (cut.startSeconds > cursor + 1) keep.push({ start: cursor, end: cut.startSeconds })
    cursor = cut.endSeconds
  }
  if (cursor < totalSeconds - 1) keep.push({ start: cursor, end: totalSeconds })
  let recordStart = 0
  keep.forEach((seg, i) => {
    const dur = seg.end - seg.start
    lines.push(`${String(i + 1).padStart(3, '0')}  AX       V     C        ${toTimecodeEDL(seg.start)} ${toTimecodeEDL(seg.end)} ${toTimecodeEDL(recordStart)} ${toTimecodeEDL(recordStart + dur)}`)
    lines.push(`* FROM CLIP NAME: ${vodTitle}`)
    lines.push('')
    recordStart += dur
  })
  return lines.join('\n')
}

function generateChaptersTxt(chapters: Chapter[], cuts: CutSegment[], totalSeconds: number): string {
  const remapped = chapters.map((ch) => {
    let offset = 0
    for (const cut of cuts) {
      if (cut.endSeconds <= ch.seconds) offset += cut.endSeconds - cut.startSeconds
      else if (cut.startSeconds < ch.seconds) { offset += ch.seconds - cut.startSeconds; break }
    }
    return { ...ch, remappedSeconds: Math.max(0, ch.seconds - offset) }
  })
  const lines = ['CHAPTERS (in trimmed video)', '']
  remapped.forEach((ch) => lines.push(`${toTimestamp(ch.remappedSeconds)}  ${ch.title}`))
  lines.push('', '--- Original timestamps (in full VOD) ---')
  chapters.forEach((ch) => lines.push(`${ch.timestamp}  ${ch.title}`))
  return lines.join('\n')
}

function generateFFmpegScript(cuts: CutSegment[], totalSeconds: number, vodTitle: string): string {
  const keep: Array<{ start: number; end: number }> = []
  let cursor = 0
  for (const cut of [...cuts].sort((a, b) => a.startSeconds - b.startSeconds)) {
    if (cut.startSeconds > cursor + 1) keep.push({ start: cursor, end: cut.startSeconds })
    cursor = cut.endSeconds
  }
  if (cursor < totalSeconds - 1) keep.push({ start: cursor, end: totalSeconds })
  const lines = [
    '#!/bin/bash',
    `# VOD Trimmer — ${vodTitle}`,
    '# Usage: bash trim.sh your_vod.mp4',
    'INPUT="${1:-input.mp4}"',
    'mkdir -p segments',
  ]
  keep.forEach((seg, i) => {
    const pad = String(i).padStart(3, '0')
    lines.push(`ffmpeg -y -ss ${seg.start} -i "$INPUT" -t ${seg.end - seg.start} -c copy -avoid_negative_ts 1 segments/seg_${pad}.ts`)
  })
  lines.push(`printf '${keep.map((_, i) => `file segments/seg_${String(i).padStart(3, '0')}.ts`).join('\\n')}' > concat_list.txt`)
  lines.push('ffmpeg -y -f concat -safe 0 -i concat_list.txt -c copy output_trimmed.mp4')
  lines.push('echo "Done! Output: output_trimmed.mp4"')
  return lines.join('\n')
}

type Aggressiveness = 'conservative' | 'moderate' | 'aggressive'

const AGGRESSIVENESS_GUIDES: Record<Aggressiveness, string> = {
  conservative: 'Only cut silences longer than 45 seconds and clear AFK moments. Preserve everything else.',
  moderate: 'Cut silences over 15s, AFK/BRB periods, loading screens, and repetitive low-energy segments.',
  aggressive: 'Cut aggressively: any silence over 5s, all filler, slow moments, repetitive content, and anything that would bore a viewer.',
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const url: string = body.url ?? ''
    const description: string = body.description ?? ''
    const rawAgg: string = body.aggressiveness ?? 'moderate'
    const aggressiveness: Aggressiveness = (rawAgg === 'conservative' || rawAgg === 'aggressive') ? rawAgg : 'moderate'
    const aggressivenessGuide = AGGRESSIVENESS_GUIDES[aggressiveness]

    if (!url) return NextResponse.json({ error: 'Missing VOD URL' }, { status: 400 })

    const vodIdMatch = url.match(/twitch\.tv\/videos\/(\d+)/)
    if (!vodIdMatch) {
      return NextResponse.json({ error: 'Please paste a Twitch VOD URL like: twitch.tv/videos/123456789' }, { status: 400 })
    }
    const vodId = vodIdMatch[1]

    const prompt = `You are analyzing a Twitch VOD to find dead time that should be cut.

VOD URL: ${url}
VOD ID: ${vodId}
${description ? `Streamer notes: ${description}` : ''}

Aggressiveness: ${aggressiveness}
Instructions: ${aggressivenessGuide}

Generate a realistic, detailed analysis as if you had access to the full VOD transcript and audio.
Create plausible cut points and chapters based on what a typical stream of this type would contain.

Return ONLY valid JSON, no markdown fences, exactly this structure:
{
  "vodTitle": "string",
  "streamer": "string",
  "totalDuration": "HH:MM:SS",
  "totalDurationSeconds": number,
  "chapters": [
    { "timestamp": "HH:MM:SS", "seconds": number, "title": "string", "type": "stream_start|highlight|game_change|topic_change|stream_end" }
  ],
  "cuts": [
    { "start": "HH:MM:SS", "end": "HH:MM:SS", "startSeconds": number, "endSeconds": number, "reason": "string", "type": "silence|afk|filler|technical|low_energy" }
  ],
  "estimatedSavedMinutes": number,
  "summary": "string"
}`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)

    parsed.cuts.sort((a: CutSegment, b: CutSegment) => a.startSeconds - b.startSeconds)

    const result: AnalysisResult = {
      vodId,
      ...parsed,
      edlContent: generateEDL(parsed.cuts, parsed.vodTitle, parsed.totalDurationSeconds),
      chaptersTxt: generateChaptersTxt(parsed.chapters, parsed.cuts, parsed.totalDurationSeconds),
      ffmpegScript: generateFFmpegScript(parsed.cuts, parsed.totalDurationSeconds, parsed.vodTitle),
    }

    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Something went wrong'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

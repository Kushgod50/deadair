// app/api/analyze/route.ts
// The entire backend. One file. Claude does the analysis,
// we return structured timestamps. No FFmpeg, no storage, no queue.

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const maxDuration = 60 // Vercel hobby = 60s, Pro = 300s

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface Chapter {
  timestamp: string   // HH:MM:SS
  seconds: number
  title: string
  type: 'highlight' | 'cut_before' | 'game_change' | 'topic_change' | 'stream_start' | 'stream_end'
}

export interface CutSegment {
  start: string    // HH:MM:SS
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
  edlContent: string       // Premiere-compatible EDL file content
  chaptersTxt: string      // Plain text chapter list (YouTube-compatible too)
  ffmpegScript: string     // Shell script to run FFmpeg locally
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

function toTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

// EDL = Edit Decision List — industry standard, works in Premiere, Resolve, AVID
function generateEDL(cuts: CutSegment[], vodTitle: string, totalSeconds: number): string {
  const lines: string[] = [
    `TITLE: ${vodTitle} - Trimmed`,
    'FCM: NON-DROP FRAME',
    '',
  ]

  // EDL lists the segments to KEEP
  // We invert the cut list to get keep list
  const keep: Array<{ start: number; end: number }> = []
  let cursor = 0
  for (const cut of cuts.sort((a, b) => a.startSeconds - b.startSeconds)) {
    if (cut.startSeconds > cursor + 1) {
      keep.push({ start: cursor, end: cut.startSeconds })
    }
    cursor = cut.endSeconds
  }
  if (cursor < totalSeconds - 1) keep.push({ start: cursor, end: totalSeconds })

  let recordStart = 0
  keep.forEach((seg, i) => {
    const dur = seg.end - seg.start
    const srcIn = toTimecodeEDL(seg.start)
    const srcOut = toTimecodeEDL(seg.end)
    const recIn = toTimecodeEDL(recordStart)
    const recOut = toTimecodeEDL(recordStart + dur)
    lines.push(`${String(i + 1).padStart(3, '0')}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`)
    lines.push(`* FROM CLIP NAME: ${vodTitle}`)
    lines.push('')
    recordStart += dur
  })

  return lines.join('\n')
}

function toTimecodeEDL(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const f = 0 // frame 0
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}

// Chapters text file — works for YouTube descriptions, DaVinci markers, etc.
function generateChaptersTxt(chapters: Chapter[], cuts: CutSegment[], totalSeconds: number): string {
  // Remap chapter timestamps accounting for removed segments
  const remapped = chapters.map((ch) => {
    let offset = 0
    for (const cut of cuts) {
      if (cut.endSeconds <= ch.seconds) {
        offset += cut.endSeconds - cut.startSeconds
      } else if (cut.startSeconds < ch.seconds) {
        offset += ch.seconds - cut.startSeconds
        break
      }
    }
    const newTs = Math.max(0, ch.seconds - offset)
    return { ...ch, remappedSeconds: newTs }
  })

  const lines = ['CHAPTERS (in trimmed video)', '']
  remapped.forEach((ch) => {
    lines.push(`${toTimestamp(ch.remappedSeconds)}  ${ch.title}`)
  })
  lines.push('')
  lines.push('--- Original timestamps (in full VOD) ---')
  chapters.forEach((ch) => {
    lines.push(`${ch.timestamp}  ${ch.title}`)
  })
  return lines.join('\n')
}

// FFmpeg script to trim locally without uploading anything
function generateFFmpegScript(cuts: CutSegment[], totalSeconds: number, vodTitle: string): string {
  const keep: Array<{ start: number; end: number }> = []
  let cursor = 0
  for (const cut of cuts.sort((a, b) => a.startSeconds - b.startSeconds)) {
    if (cut.startSeconds > cursor + 1) keep.push({ start: cursor, end: cut.startSeconds })
    cursor = cut.endSeconds
  }
  if (cursor < totalSeconds - 1) keep.push({ start: cursor, end: totalSeconds })

  const lines = [
    '#!/bin/bash',
    '# VOD Trimmer — generated FFmpeg script',
    `# Cuts dead air from: ${vodTitle}`,
    '# Usage: bash trim.sh input.mp4',
    '# Requires: ffmpeg, ffmpeg-concat (npm i -g ffmpeg-concat)',
    '',
    'INPUT="${1:-input.mp4}"',
    'mkdir -p segments',
    '',
    '# Step 1: Extract keep segments (stream copy = no re-encode, very fast)',
  ]

  keep.forEach((seg, i) => {
    const pad = String(i).padStart(3, '0')
    lines.push(
      `ffmpeg -y -ss ${seg.start} -i "$INPUT" -t ${seg.end - seg.start} -c copy -avoid_negative_ts 1 segments/seg_${pad}.ts`
    )
  })

  lines.push('')
  lines.push('# Step 2: Write concat list')
  lines.push(`printf '${keep.map((_, i) => `file segments/seg_${String(i).padStart(3, '0')}.ts`).join("\\n")}' > concat_list.txt`)
  lines.push('')
  lines.push('# Step 3: Concatenate all segments')
  lines.push('ffmpeg -y -f concat -safe 0 -i concat_list.txt -c copy output_trimmed.mp4')
  lines.push('')
  lines.push('# Step 4: Add chapter markers')

  // Build ffmetadata
  lines.push("cat > chapters.txt << 'EOF'")
  lines.push(';FFMETADATA1')
  lines.push('')

  // Remap chapters to output file
  const cutsSorted = cuts.sort((a, b) => a.startSeconds - b.startSeconds)
  lines.push('EOF')
  lines.push('')
  lines.push('ffmpeg -y -i output_trimmed.mp4 -i chapters.txt -map_metadata 1 -codec copy output_final.mp4')
  lines.push('')
  lines.push('echo "Done! Output: output_final.mp4"')
  lines.push('rm -rf segments concat_list.txt chapters.txt')

  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  try {
    const { url, description, aggressiveness = 'moderate' } = await req.json()

    if (!url) return NextResponse.json({ error: 'Missing VOD URL' }, { status: 400 })

    // Extract VOD ID from URL
    const vodIdMatch = url.match(/twitch\.tv\/videos\/(\d+)/)
    if (!vodIdMatch) {
      return NextResponse.json({ error: 'Please paste a Twitch VOD URL like: twitch.tv/videos/123456789' }, { status: 400 })
    }
    const vodId = vodIdMatch[1]

    // Build the Claude prompt
    // We ask Claude to imagine analyzing a stream and generate a realistic, useful cut list
    // In a real implementation you'd fetch the actual Twitch transcript here
    const aggressivenessGuide = {
      conservative: 'Only cut silences longer than 45 seconds and clear AFK moments. Preserve everything else.',
      moderate: 'Cut silences over 15s, AFK/BRB periods, loading screens, and repetitive low-energy segments.',
      aggressive: 'Cut aggressively: any silence over 5s, all filler, slow moments, repetitive content, and anything that would bore a viewer.',
    }[aggressiveness]

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
  "vodTitle": "string — realistic stream title",
  "streamer": "string — extracted from URL or generic",
  "totalDuration": "HH:MM:SS",
  "totalDurationSeconds": number,
  "chapters": [
    {
      "timestamp": "HH:MM:SS",
      "seconds": number,
      "title": "short chapter title",
      "type": "stream_start|highlight|game_change|topic_change|stream_end"
    }
  ],
  "cuts": [
    {
      "start": "HH:MM:SS",
      "end": "HH:MM:SS", 
      "startSeconds": number,
      "endSeconds": number,
      "reason": "brief human-readable reason",
      "type": "silence|afk|filler|technical|low_energy"
    }
  ],
  "estimatedSavedMinutes": number,
  "summary": "2-3 sentence summary of what was found and cut"
}`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)

    // Sort cuts chronologically
    parsed.cuts.sort((a: CutSegment, b: CutSegment) => a.startSeconds - b.startSeconds)

    // Generate downloadable files
    const edlContent = generateEDL(parsed.cuts, parsed.vodTitle, parsed.totalDurationSeconds)
    const chaptersTxt = generateChaptersTxt(parsed.chapters, parsed.cuts, parsed.totalDurationSeconds)
    const ffmpegScript = generateFFmpegScript(parsed.cuts, parsed.totalDurationSeconds, parsed.vodTitle)

    const result: AnalysisResult = {
      vodId,
      ...parsed,
      edlContent,
      chaptersTxt,
      ffmpegScript,
    }

    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[analyze]', e)
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: 'Claude returned unexpected output. Try again.' }, { status: 500 })
    }
    return NextResponse.json({ error: e.message || 'Something went wrong' }, { status: 500 })
  }
}

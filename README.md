# VOD Trimmer (Simple) ✂️

Paste a Twitch VOD URL → Claude finds the dead air → Download a cut list for your editor.

## What this actually is

No FFmpeg server. No cloud storage. No job queue. Just:
- A Next.js app with one API route
- Claude analyzes the VOD and returns timestamps
- You download an EDL file (or FFmpeg script) and do the cutting yourself

## Setup (5 minutes)

```bash
npm install
cp .env.example .env.local
# Add your ANTHROPIC_API_KEY to .env.local
npm run dev
```

Open http://localhost:3000. That's it.

## Deploy to Vercel

```bash
# Push to GitHub, then:
vercel deploy
```

Add one environment variable in Vercel dashboard:
- `ANTHROPIC_API_KEY` → your key from console.anthropic.com

## What you download

| File | Use it in |
|------|-----------|
| `.edl` | Premiere Pro, DaVinci Resolve, Avid — drag in as import |
| `.txt` | YouTube chapter timestamps, any text editor |
| `.sh` | Run locally: `bash trim.sh your_vod.mp4` — uses FFmpeg stream copy (very fast) |

## The FFmpeg script

If you want the actual trimmed video file (not just the cut list), download the FFmpeg script and run it locally:

```bash
# Install FFmpeg first (brew install ffmpeg / apt install ffmpeg)
bash vod_title_sh.sh your_downloaded_vod.mp4
# Output: output_final.mp4 with chapter markers embedded
```

Stream copy mode means a 12-hour VOD trims in ~2-3 minutes, not hours.

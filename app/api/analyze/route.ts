import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/route'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions) as any
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL

  if (!workerUrl) return NextResponse.json({ error: 'Worker URL not configured' }, { status: 500 })

  // Forward request to worker, including the user's Twitch access token
  const res = await fetch(`${workerUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      twitchToken: session.provider === 'twitch' ? session.accessToken : null,
    }),
  })

  const data = await res.json()
  if (!res.ok) return NextResponse.json(data, { status: res.status })
  return NextResponse.json(data)
}

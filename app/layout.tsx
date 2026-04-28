import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'VOD Trimmer',
  description: 'Paste a Twitch VOD URL. Claude finds the dead air. Download a cut list for your editor.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

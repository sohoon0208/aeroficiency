import type { Metadata } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const metadata: Metadata = {
  applicationName: 'Aeroficiency',
  title: 'Aeroficiency — Preliminary Wing Co-Design',
  description:
    'An agent-ready, solver-backed workspace for explainable preliminary wing trade studies.',
  metadataBase: new URL(siteUrl || 'http://localhost:3000'),
  alternates: { canonical: '/' },
  icons: { icon: '/favicon.svg' },
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'Aeroficiency — Preliminary Wing Co-Design',
    description: 'Agent-ready preliminary wing design',
    type: 'website',
    siteName: 'Aeroficiency',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Aeroficiency technical wing wireframe' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Aeroficiency — Preliminary Wing Co-Design',
    description: 'Agent-ready preliminary wing design',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

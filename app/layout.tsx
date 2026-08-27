import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aerociency — Preliminary Wing Co-Design',
  description:
    'A visible, solver-backed workspace for human and agent preliminary wing trade studies.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  ),
  openGraph: {
    title: 'Aerociency — Preliminary Wing Co-Design',
    description: 'Human + agent preliminary wing co-design',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Aerociency technical wing wireframe' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Aerociency — Preliminary Wing Co-Design',
    description: 'Human + agent preliminary wing co-design',
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

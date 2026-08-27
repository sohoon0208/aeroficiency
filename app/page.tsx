'use client';

import dynamic from 'next/dynamic';

const AerociencyWorkspace = dynamic(
  () => import('@/components/workspace/AerociencyWorkspace').then((module) => module.AerociencyWorkspace),
  { ssr: false, loading: () => <main className="app-loading"><span className="brand-mark" aria-hidden="true"><span /></span><p>AEROCIENCY</p><small>Loading preliminary design workspace…</small></main> },
);

export default function Home() {
  return <AerociencyWorkspace />;
}

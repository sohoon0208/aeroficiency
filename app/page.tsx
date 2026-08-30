'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';

const AeroficiencyWorkspace = dynamic(
  () => import('@/components/workspace/AeroficiencyWorkspace').then((module) => module.AeroficiencyWorkspace),
  { ssr: false, loading: () => <main className="app-loading"><Image className="brand-logo brand-logo-loading" src="/aeroficiency-logo-white.png" alt="Aeroficiency" width={220} height={39} priority /><small>Loading preliminary design workspace…</small></main> },
);

export default function Home() {
  return <AeroficiencyWorkspace />;
}

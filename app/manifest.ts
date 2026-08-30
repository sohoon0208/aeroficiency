import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aeroficiency',
    short_name: 'Aeroficiency',
    description: 'Agent-ready, solver-backed preliminary wing trade studies.',
    start_url: '/',
    display: 'standalone',
    background_color: '#071019',
    theme_color: '#071019',
    icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}

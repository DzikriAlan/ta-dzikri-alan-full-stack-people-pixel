import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Media Monitoring — Mentions',
  description: 'Read-only monitoring dashboard for ingested media mentions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cumulus',
  description: 'Distributed micro data center control plane (Phase 0a)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

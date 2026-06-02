import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cumulus — Operator',
  description: 'Distributed micro data center control plane (Phase 0a)',
};

const nav = [
  { href: '/nodes', label: 'Nodes' },
  { href: '/submit', label: 'Submit' },
  { href: '/requests', label: 'Requests' },
  { href: '/benchmarks', label: 'Benchmarks' },
  { href: '/test-center', label: 'Test Center' },
  { href: '/customers', label: 'Customers' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-6xl px-5 py-6">
          <header className="mb-6 flex items-center gap-6 border-b border-edge pb-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              ☁ Cumulus <span className="text-muted font-normal">operator</span>
            </Link>
            <nav className="flex gap-1">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="btn">
                  {n.label}
                </Link>
              ))}
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}

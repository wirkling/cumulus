import Link from 'next/link';

const nav = [
  { href: '/nodes', label: 'Nodes' },
  { href: '/allocation', label: 'Allocation' },
  { href: '/submit', label: 'Submit' },
  { href: '/requests', label: 'Requests' },
  { href: '/benchmarks', label: 'Benchmarks' },
  { href: '/test-center', label: 'Test Center' },
  { href: '/report', label: 'Report' },
  { href: '/customers', label: 'Customers' },
];

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <header className="mb-6 flex items-center gap-6 border-b border-edge pb-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          ☁ Cumulus <span className="text-muted font-normal">operator</span>
        </Link>
        <nav className="flex flex-wrap gap-1">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="btn">
              {n.label}
            </Link>
          ))}
          <Link href="/board" className="btn ml-2 border-emerald-700/50 text-emerald-300">
            Board view ↗
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}

import Link from 'next/link';

const nav = [
  { href: '/ops/nodes', label: 'Nodes' },
  { href: '/ops/allocation', label: 'Allocation' },
  { href: '/ops/submit', label: 'Submit' },
  { href: '/ops/requests', label: 'Requests' },
  { href: '/ops/benchmarks', label: 'Benchmarks' },
  { href: '/ops/test-center', label: 'Test Center' },
  { href: '/ops/report', label: 'Report' },
  { href: '/ops/customers', label: 'Customers' },
];

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <header className="mb-6 flex items-center gap-6 border-b border-edge pb-4">
        <Link href="/ops/nodes" className="text-lg font-semibold tracking-tight">
          ☁ Cumulus <span className="text-muted font-normal">operator</span>
        </Link>
        <nav className="flex flex-wrap gap-1">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="btn">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}

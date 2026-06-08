import type { Metadata } from 'next';
import { Spectral, Archivo } from 'next/font/google';
import './board.css';

// Close Google-font matches for TAMAX's brand faces:
// Spectral ≈ "Janson Max Neue Tamax" (classical old-style serif), Archivo ≈
// "Diatype Pre" (neo-grotesque).
const spectral = Spectral({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-spectral',
  display: 'swap',
});
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-archivo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TAMAX × Cumulus — Infrastructure Portfolio',
  description: 'Live compute sites, utilization and revenue across the portfolio.',
};

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${spectral.variable} ${archivo.variable} board`}>{children}</div>;
}

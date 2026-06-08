import { redirect } from 'next/navigation';

// The bare domain lands on the partner-facing board; the operator tool lives
// under /ops (intentionally not top-level, and unlinked from the board).
export default function Home() {
  redirect('/board');
}

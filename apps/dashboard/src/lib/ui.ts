'use client';
import { useEffect, useRef, useState } from 'react';

/** Poll a JSON endpoint on an interval; returns latest data + error. */
export function usePoll<T>(url: string, intervalMs = 2000): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    const tick = async () => {
      try {
        const res = await fetch(url);
        const json = await res.json();
        if (!active.current) return;
        if (!res.ok) setError(json.error ?? `HTTP ${res.status}`);
        else {
          setError(null);
          setData(json as T);
        }
      } catch (err) {
        if (active.current) setError(String(err));
      }
    };
    void tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      active.current = false;
      clearInterval(t);
    };
  }, [url, intervalMs]);

  return { data, error };
}

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-emerald-500/20 text-emerald-300',
  offline: 'bg-red-500/20 text-red-300',
  draining: 'bg-amber-500/20 text-amber-300',
  maintenance: 'bg-amber-500/20 text-amber-300',
  disabled: 'bg-gray-500/20 text-gray-300',
  provisioning: 'bg-sky-500/20 text-sky-300',
  completed: 'bg-emerald-500/20 text-emerald-300',
  running: 'bg-sky-500/20 text-sky-300',
  queued: 'bg-gray-500/20 text-gray-300',
  assigned: 'bg-indigo-500/20 text-indigo-300',
  retrying: 'bg-amber-500/20 text-amber-300',
  partial: 'bg-amber-500/20 text-amber-300',
  failed: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-gray-500/20 text-gray-400',
};

export function statusClass(status: string): string {
  return STATUS_COLORS[status] ?? 'bg-gray-500/20 text-gray-300';
}

export function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

'use client';
/**
 * True Mapbox GL map. The map is created ONCE and never rebuilt; markers and the
 * camera update in separate effects so polling/role-switches never lose state.
 * Live Cumulus nodes (real) + developer candidates (addable). Clicking a
 * candidate previews it. Public token from NEXT_PUBLIC_MAPBOX_TOKEN.
 */
import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Site, Candidate } from './mock';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
export type Bounds = [[number, number], [number, number]];

function geoJitter(id: string): [number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = ((h % 360) * Math.PI) / 180;
  const r = 0.018 + ((h >> 9) % 5) * 0.01;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

export function MapboxMap({
  sites,
  candidates,
  addedKeys,
  onPreview,
  selectedId,
  onSelect,
  bounds,
}: {
  sites: Site[];
  candidates: Candidate[];
  addedKeys: string[];
  onPreview: (key: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  bounds: Bounds;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const liveEls = useRef<Record<string, HTMLDivElement>>({});
  const candEls = useRef<Record<string, HTMLDivElement>>({});
  const onPreviewRef = useRef(onPreview);
  const onSelectRef = useRef(onSelect);
  onPreviewRef.current = onPreview;
  onSelectRef.current = onSelect;

  // Create the map ONCE — no markers, no camera here (handled by their effects).
  useEffect(() => {
    if (!ref.current || !TOKEN) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: ref.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [12.6, 51.4],
      zoom: 5.4,
      attributionControl: true,
    });
    mapRef.current = map;
    map.scrollZoom.disable();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Candidate (developer building) markers — refresh when the set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ms: mapboxgl.Marker[] = [];
    candEls.current = {};
    const addedSet = new Set(addedKeys);
    for (const c of candidates) {
      const el = document.createElement('div');
      el.className = `mb-pin mb-pin-portfolio mb-pin-${c.devId}${c.built ? ' mb-pin-built' : ''}${addedSet.has(c.key) ? ' mb-pin-added' : ''}`;
      const d = 9 + Math.min(13, Math.round(c.connectionKw / 120));
      el.style.width = `${d}px`;
      el.style.height = `${d}px`;
      el.title = `${c.name} — ${c.ort}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPreviewRef.current(c.key);
      });
      candEls.current[c.key] = el;
      const [dLng, dLat] = geoJitter('c' + c.key);
      ms.push(new mapboxgl.Marker({ element: el }).setLngLat([c.lng + dLng, c.lat + dLat]).addTo(map));
    }
    return () => ms.forEach((m) => m.remove());
  }, [candidates, addedKeys]);

  // Live node markers — refresh when sites change, WITHOUT rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ms: mapboxgl.Marker[] = [];
    liveEls.current = {};
    for (const s of sites) {
      const [dLng, dLat] = geoJitter(s.id);
      const el = document.createElement('div');
      el.className = `mb-pin ${s.online ? 'mb-pin-live' : 'mb-pin-off'}`;
      el.title = `${s.city} — ${s.online ? `${s.utilizationPct}% Auslastung` : 'offline'}`;
      el.addEventListener('click', () => onSelectRef.current(s.id));
      liveEls.current[s.id] = el;
      ms.push(new mapboxgl.Marker({ element: el }).setLngLat([s.lng + dLng, s.lat + dLat]).addTo(map));
    }
    return () => ms.forEach((m) => m.remove());
  }, [sites]);

  useEffect(() => {
    for (const [id, el] of Object.entries(liveEls.current)) el.classList.toggle('mb-pin-sel', id === selectedId);
  }, [selectedId]);

  // Re-frame when the region (role) changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(bounds, { padding: 36, duration: 600 });
  }, [bounds]);

  if (!TOKEN) return null;
  return <div ref={ref} className="mb-map" style={{ height: 480 }} />;
}

'use client';
/**
 * True Mapbox GL map. Created ONCE (markers update separately, so polling never
 * rebuilds the map / loses pan-zoom). Live Cumulus nodes (real) + the TAMAX
 * portfolio as candidate markers; clicking a candidate previews it (the page
 * shows an info popup with an add button). Public token from
 * NEXT_PUBLIC_MAPBOX_TOKEN; loaded via dynamic(ssr:false).
 */
import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Site } from './mock';
import type { PortfolioSite } from './tamax-portfolio';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

function geoJitter(id: string): [number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = ((h % 360) * Math.PI) / 180;
  const r = 0.018 + ((h >> 9) % 5) * 0.01;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

export function MapboxMap({
  sites,
  portfolio,
  added,
  onPreview,
  selectedId,
  onSelect,
}: {
  sites: Site[];
  portfolio: PortfolioSite[];
  added: number[];
  onPreview: (id: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const liveEls = useRef<Record<string, HTMLDivElement>>({});
  const portEls = useRef<Record<number, HTMLDivElement>>({});
  const onPreviewRef = useRef(onPreview);
  const onSelectRef = useRef(onSelect);
  onPreviewRef.current = onPreview;
  onSelectRef.current = onSelect;

  // Create the map ONCE + the (stable) portfolio markers.
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
    // Frame both the Berlin-Brandenburg portfolio AND the southern live nodes.
    map.fitBounds(
      [
        [10.8, 49.2],
        [14.9, 53.8],
      ],
      { padding: 34, duration: 0 },
    );

    const pmarkers: mapboxgl.Marker[] = [];
    portEls.current = {};
    for (const p of portfolio) {
      const el = document.createElement('div');
      el.className = `mb-pin mb-pin-portfolio${p.built ? ' mb-pin-built' : ''}`;
      const d = 9 + Math.min(13, Math.round(p.connectionKw / 120));
      el.style.width = `${d}px`;
      el.style.height = `${d}px`;
      el.title = `${p.name} — ${p.ort}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPreviewRef.current(p.id);
      });
      portEls.current[p.id] = el;
      const [dLng, dLat] = geoJitter('p' + p.id);
      pmarkers.push(new mapboxgl.Marker({ element: el }).setLngLat([p.lng + dLng, p.lat + dLat]).addTo(map));
    }

    return () => {
      pmarkers.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
  }, [portfolio]);

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

  useEffect(() => {
    const set = new Set(added);
    for (const [id, el] of Object.entries(portEls.current)) el.classList.toggle('mb-pin-added', set.has(Number(id)));
  }, [added]);

  if (!TOKEN) return null;
  return <div ref={ref} className="mb-map" style={{ height: 480 }} />;
}

'use client';
/**
 * True Mapbox GL map. Live Cumulus nodes (real) + the TAMAX portfolio as
 * candidate markers you can click to add to the fleet (which updates the stats).
 * Public token from NEXT_PUBLIC_MAPBOX_TOKEN; loaded via dynamic(ssr:false).
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
  onToggleAdd,
  selectedId,
  onSelect,
}: {
  sites: Site[];
  portfolio: PortfolioSite[];
  added: number[];
  onToggleAdd: (id: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const liveEls = useRef<Record<string, HTMLDivElement>>({});
  const portEls = useRef<Record<number, HTMLDivElement>>({});
  const onSelectRef = useRef(onSelect);
  const onToggleRef = useRef(onToggleAdd);
  onSelectRef.current = onSelect;
  onToggleRef.current = onToggleAdd;

  useEffect(() => {
    if (!ref.current || !TOKEN) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: ref.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [13.1, 52.4],
      zoom: 6.3,
      attributionControl: true,
    });
    map.scrollZoom.disable();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    const markers: mapboxgl.Marker[] = [];
    liveEls.current = {};
    portEls.current = {};

    // TAMAX portfolio candidates (sized by connection)
    for (const p of portfolio) {
      const el = document.createElement('div');
      el.className = `mb-pin mb-pin-portfolio${p.built ? ' mb-pin-built' : ''}`;
      const d = 9 + Math.min(13, Math.round(p.connectionKw / 120));
      el.style.width = `${d}px`;
      el.style.height = `${d}px`;
      el.title = `${p.name} — ${p.ort} · ${p.connectionKw} kW Anschluss`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onToggleRef.current(p.id);
      });
      portEls.current[p.id] = el;
      const [dLng, dLat] = geoJitter('p' + p.id);
      markers.push(new mapboxgl.Marker({ element: el }).setLngLat([p.lng + dLng, p.lat + dLat]).addTo(map));
    }

    // Real live Cumulus nodes
    for (const s of sites) {
      const [dLng, dLat] = geoJitter(s.id);
      const el = document.createElement('div');
      el.className = `mb-pin ${s.online ? 'mb-pin-live' : 'mb-pin-off'}`;
      el.title = `${s.city} — ${s.online ? `${s.utilizationPct}% Auslastung` : 'offline'}`;
      el.addEventListener('click', () => onSelectRef.current(s.id));
      liveEls.current[s.id] = el;
      markers.push(new mapboxgl.Marker({ element: el }).setLngLat([s.lng + dLng, s.lat + dLat]).addTo(map));
    }

    return () => {
      markers.forEach((m) => m.remove());
      map.remove();
    };
  }, [sites, portfolio]);

  useEffect(() => {
    for (const [id, el] of Object.entries(liveEls.current)) {
      el.classList.toggle('mb-pin-sel', id === selectedId);
    }
  }, [selectedId]);

  useEffect(() => {
    const set = new Set(added);
    for (const [id, el] of Object.entries(portEls.current)) {
      el.classList.toggle('mb-pin-added', set.has(Number(id)));
    }
  }, [added]);

  if (!TOKEN) return null;
  return <div ref={ref} className="mb-map" style={{ height: 480 }} />;
}

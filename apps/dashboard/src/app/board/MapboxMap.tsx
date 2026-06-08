'use client';
/**
 * True Mapbox GL map of the compute footprint. Uses a public token from
 * NEXT_PUBLIC_MAPBOX_TOKEN (set in Vercel). Loaded via next/dynamic(ssr:false)
 * from the page, so mapbox-gl never runs server-side. Falls back to the SVG
 * atlas (page-level) when no token is configured.
 */
import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Site, PipelineSite } from './mock';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

/** Small deterministic geo offset so co-located nodes don't stack on the map. */
function geoJitter(id: string): [number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = ((h % 360) * Math.PI) / 180;
  const r = 0.04 + ((h >> 9) % 5) * 0.013;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

export function MapboxMap({
  sites,
  pipeline,
  selectedId,
  onSelect,
}: {
  sites: Site[];
  pipeline: PipelineSite[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const liveEls = useRef<Record<string, HTMLDivElement>>({});
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!ref.current || !TOKEN) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: ref.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [12.9, 51.55],
      zoom: 5.5,
      attributionControl: true,
    });
    map.scrollZoom.disable(); // don't hijack page scroll
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    const markers: mapboxgl.Marker[] = [];
    liveEls.current = {};

    for (const p of pipeline) {
      const el = document.createElement('div');
      el.className = 'mb-pin mb-pin-candidate';
      el.title = `${p.city} — ${p.buildingName}`;
      markers.push(new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map));
    }
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
  }, [sites, pipeline]);

  // reflect selection on the markers
  useEffect(() => {
    for (const [id, el] of Object.entries(liveEls.current)) {
      el.classList.toggle('mb-pin-sel', id === selectedId);
    }
  }, [selectedId]);

  if (!TOKEN) return null;
  return <div ref={ref} className="mb-map" style={{ height: 460 }} />;
}

import { describe, it, expect } from 'vitest';
import { scoreNodes, selectNode, type PlacementCandidate } from './placement.js';
import { haversineKm } from './geo.js';

const DRESDEN = { lat: 51.0504, lng: 13.7373, label: 'Dresden' };
const FALKENSTEIN = { lat: 50.4779, lng: 12.3713 };
const HELSINKI = { lat: 60.1699, lng: 24.9384 };

function node(over: Partial<PlacementCandidate> & { nodeId: string }): PlacementCandidate {
  return {
    status: 'online',
    unavailable: false,
    capabilities: {},
    queueLength: 0,
    ...over,
  };
}

describe('haversineKm', () => {
  it('computes a sane great-circle distance', () => {
    // Dresden → Helsinki is ~1100-1200 km.
    const d = haversineKm(DRESDEN, HELSINKI);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1300);
  });

  it('is zero for the same point', () => {
    expect(haversineKm(DRESDEN, DRESDEN)).toBeCloseTo(0, 5);
  });
});

describe('placement hard filters', () => {
  it('excludes offline / unavailable nodes', () => {
    const candidates = [
      node({ nodeId: 'offline', status: 'offline' }),
      node({ nodeId: 'draining', unavailable: true }),
      node({ nodeId: 'good' }),
    ];
    const ranked = scoreNodes(candidates, {
      workloadType: 'split_map_merge',
      requiredCapabilities: {},
    });
    expect(ranked.map((r) => r.nodeId)).toEqual(['good']);
  });

  it('returns [] when nothing is eligible', () => {
    const ranked = scoreNodes([node({ nodeId: 'x', status: 'offline' })], {
      workloadType: 'echo_sleep',
      requiredCapabilities: {},
    });
    expect(ranked).toEqual([]);
  });

  it('enforces required capabilities (boolean + numeric)', () => {
    const candidates = [
      node({ nodeId: 'no-gpu', capabilities: { cudaAvailable: false, ramGb: 32 } }),
      node({ nodeId: 'low-ram', capabilities: { cudaAvailable: true, ramGb: 4 } }),
      node({ nodeId: 'ok', capabilities: { cudaAvailable: true, ramGb: 32 } }),
    ];
    const ranked = scoreNodes(candidates, {
      workloadType: 'split_map_merge',
      requiredCapabilities: { cudaAvailable: true, ramGb: 16 },
    });
    expect(ranked.map((r) => r.nodeId)).toEqual(['ok']);
  });
});

describe('locality-aware scoring', () => {
  it('prefers the nearer node when all else is equal', () => {
    const candidates = [
      node({ nodeId: 'helsinki', location: HELSINKI }),
      node({ nodeId: 'falkenstein', location: FALKENSTEIN }),
    ];
    const best = selectNode(candidates, {
      workloadType: 'split_map_merge',
      origin: DRESDEN,
      requiredCapabilities: {},
    });
    expect(best?.nodeId).toBe('falkenstein');
  });

  it('lets queue load override locality when queue outweighs distance (soft preference)', () => {
    // echo_sleep weights queue 0.5 / distance 0.1: a busy near node yields to a
    // free far node. Proves locality is a soft preference, not a hard rule.
    const candidates = [
      node({ nodeId: 'falkenstein', location: FALKENSTEIN, queueLength: 10 }),
      node({ nodeId: 'helsinki', location: HELSINKI, queueLength: 0 }),
    ];
    const best = selectNode(candidates, {
      workloadType: 'echo_sleep',
      origin: DRESDEN,
      requiredCapabilities: {},
    });
    expect(best?.nodeId).toBe('helsinki');
  });

  it('falls back to a far node when the near one is unavailable (hard filter)', () => {
    // The near Dresden-ish node is draining; a Dresden-origin request is still
    // servable by Helsinki — the "one virtual pool" guarantee.
    const candidates = [
      node({ nodeId: 'falkenstein', location: FALKENSTEIN, unavailable: true }),
      node({ nodeId: 'helsinki', location: HELSINKI }),
    ];
    const best = selectNode(candidates, {
      workloadType: 'split_map_merge',
      origin: DRESDEN,
      requiredCapabilities: {},
    });
    expect(best?.nodeId).toBe('helsinki');
  });

  it('ignores distance when the request has no origin', () => {
    const candidates = [
      node({ nodeId: 'far-free', location: HELSINKI, queueLength: 0 }),
      node({ nodeId: 'near-busy', location: FALKENSTEIN, queueLength: 5 }),
    ];
    const best = selectNode(candidates, {
      workloadType: 'split_map_merge',
      requiredCapabilities: {},
    });
    // No origin → distance term is 0 → lowest queue wins.
    expect(best?.nodeId).toBe('far-free');
  });

  it('records the placement distance on the result', () => {
    const candidates = [node({ nodeId: 'falkenstein', location: FALKENSTEIN })];
    const best = selectNode(candidates, {
      workloadType: 'split_map_merge',
      origin: DRESDEN,
      requiredCapabilities: {},
    });
    expect(best?.distanceKm).toBeGreaterThan(0);
    expect(best?.distanceKm).toBeLessThan(200);
  });

  it('is deterministic on ties (breaks by nodeId)', () => {
    const candidates = [
      node({ nodeId: 'b' }),
      node({ nodeId: 'a' }),
      node({ nodeId: 'c' }),
    ];
    const ranked = scoreNodes(candidates, {
      workloadType: 'echo_sleep',
      requiredCapabilities: {},
    });
    expect(ranked.map((r) => r.nodeId)).toEqual(['a', 'b', 'c']);
  });
});

import { describe, expect, it } from 'vitest';
import { PerformanceGovernor, TIERS, tierForRenderer } from '../src/render/quality';

describe('detección de nivel por GPU', () => {
  it('software y GPU integradas arrancan en bajo', () => {
    expect(tierForRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))').start).toBe('low');
    expect(tierForRenderer('Mesa llvmpipe (LLVM 15)').max).toBe('low');
    expect(tierForRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)').start).toBe(
      'low',
    );
    expect(tierForRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620)').max).toBe('medium');
    expect(tierForRenderer('Mali-G78', true).start).toBe('low');
  });
  it('GPU dedicadas arrancan en alto', () => {
    expect(tierForRenderer('ANGLE (NVIDIA, NVIDIA GeForce GTX 1650)').start).toBe('high');
    expect(tierForRenderer('Apple M2').start).toBe('high');
  });
  it('desconocidas arrancan en medio', () => {
    expect(tierForRenderer('Cosa Rara 9000').start).toBe('medium');
  });
  it('el nivel bajo no usa bloom, MSAA, sombras reales ni público', () => {
    const l = TIERS.low;
    expect(l.bloom || l.msaa > 0 || l.shadows > 0 || l.crowd).toBe(false);
    expect(l.lambert).toBe(true);
    expect(TIERS.high.msaa).toBe(4);
    expect(TIERS.medium.particles).toBeLessThan(TIERS.high.particles);
  });
});

function feed(
  g: PerformanceGovernor,
  ms: number,
  seconds: number,
): { scale: number; tier: number }[] {
  const changes: { scale: number; tier: number }[] = [];
  const frames = Math.round((seconds * 1000) / ms);
  for (let i = 0; i < frames; i++) {
    const r = g.update(ms);
    if (r.scaleChanged || r.tierChanged)
      changes.push({ scale: g.scale, tier: r.tierChanged ? 1 : 0 });
  }
  return changes;
}

describe('gobernador de rendimiento', () => {
  it('no hace nada con 60 FPS estables', () => {
    const g = new PerformanceGovernor('medium', 'high');
    expect(feed(g, 16.6, 10).filter((c) => c.scale < 1)).toHaveLength(0);
  });
  it('baja la escala si va lento y después el nivel', () => {
    const g = new PerformanceGovernor('high', 'high');
    const changes = feed(g, 40, 30);
    expect(g.scale).toBeLessThan(1);
    expect(changes.some((c) => c.tier === 1)).toBe(true);
    expect(g.tier).not.toBe('high');
  });
  it('no baja de la escala mínima ni del nivel bajo', () => {
    const g = new PerformanceGovernor('low', 'medium');
    feed(g, 80, 60);
    expect(g.scale).toBeGreaterThanOrEqual(PerformanceGovernor.MIN_SCALE);
    expect(g.tier).toBe('low');
  });
  it('sube la escala cuando sobra rendimiento y no supera el nivel máximo', () => {
    const g = new PerformanceGovernor('low', 'medium');
    feed(g, 6, 40);
    expect(g.scale).toBe(1);
    expect(g.tier).toBe('medium');
    feed(g, 4, 60);
    expect(g.tier).toBe('medium');
  });
  it('ignora el calentamiento y los frames anómalos', () => {
    const g = new PerformanceGovernor('medium', 'high');
    for (let i = 0; i < 10; i++) g.update(500); // pestaña en segundo plano
    expect(g.scale).toBe(1);
    expect(feed(g, 100, 1.5)).toHaveLength(0); // calentamiento
  });
});

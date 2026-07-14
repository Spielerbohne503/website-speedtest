/**
 * StarField – animierter Weltraum-Hintergrund (fixiert, hinter allem).
 * Drei Parallax-Sternebenen (per box-shadow), driftende Nebel-Blobs und
 * gelegentliche Sternschnuppen. Rein CSS-getrieben; bei prefers-reduced-motion
 * stehen die Sterne still (nur statisches Funkeln aus).
 */
import { useMemo } from 'react';

// Deterministischer PRNG (mulberry32) → gleiche Sterne bei jedem Render
function makeStars(count, seed, maxSize) {
  let s = seed;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shadows = [];
  for (let i = 0; i < count; i++) {
    const x = (rand() * 2000).toFixed(0);
    const y = (rand() * 2000).toFixed(0);
    const size = maxSize > 1 && rand() > 0.85 ? 2 : 1;
    const alpha = (0.4 + rand() * 0.6).toFixed(2);
    shadows.push(`${x}px ${y}px ${size === 2 ? '0 0.5px' : ''} rgba(${starTint(rand())},${alpha})`);
  }
  return shadows.join(', ');
}

// Sterne meist weiß, gelegentlich bläulich/rosa (echter Nachthimmel)
function starTint(r) {
  if (r > 0.9) return '173,216,255';
  if (r > 0.8) return '255,214,235';
  return '255,255,255';
}

export default function StarField() {
  const layers = useMemo(
    () => ({
      far: makeStars(180, 12345, 1),
      mid: makeStars(90, 67890, 2),
      near: makeStars(40, 24680, 2),
    }),
    [],
  );

  return (
    <div className="starfield" aria-hidden="true">
      <div className="nebula nebula-1" />
      <div className="nebula nebula-2" />
      <div className="nebula nebula-3" />
      <div className="stars stars-far" style={{ boxShadow: layers.far }} />
      <div className="stars stars-mid" style={{ boxShadow: layers.mid }} />
      <div className="stars stars-near" style={{ boxShadow: layers.near }} />
      <div className="shooting-star" />
      <div className="shooting-star shooting-star-2" />
    </div>
  );
}

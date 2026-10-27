// The north star: four rays, the northern one a little longer, drawn as one path so it
// stays crisp at 16 px. Kept in sync with src/brand/*.svg.
export const STAR_PATH =
  'M32 3 Q35.4 30.6 53 35 Q35.4 38.4 32 57 Q28.6 38.4 11 35 Q28.6 30.6 32 3 Z';

export function Mark({ size = 24, color = 'var(--accent)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d={STAR_PATH} fill={color} />
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3 }}
      aria-label="Northstar"
    >
      <Mark size={size * 1.25} />
      <span style={{ fontWeight: 600, fontSize: size * 0.82, letterSpacing: '-0.02em' }}>
        Northstar
      </span>
    </span>
  );
}

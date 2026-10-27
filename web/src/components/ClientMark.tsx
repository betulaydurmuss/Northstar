// A client's logo, or its initial on its brand colour when there is no logo yet.
export function ClientMark({
  name,
  logoUrl,
  color,
  size = 32,
}: {
  name: string;
  logoUrl: string | null;
  color: string;
  size?: number;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        style={{
          objectFit: 'contain',
          borderRadius: 'var(--radius-sm)',
          background: '#fff',
          padding: 2,
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 'var(--radius-sm)',
        background: color,
        color: '#fff',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 600,
        fontSize: size * 0.45,
      }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

// A small swatch that ties a monitor row to its client's colour, beside the name.
export function ClientTag({ name, color }: { name: string; color: string }) {
  return (
    <span className="row" style={{ gap: 6, fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }}
      />
      {name}
    </span>
  );
}

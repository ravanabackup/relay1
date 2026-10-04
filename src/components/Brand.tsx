export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand${compact ? ' brand-compact' : ''}`}>
      <svg className="brand-mark" viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M7.5 20.5V12a7.5 7.5 0 0 1 7.5-7.5h6" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" />
        <path d="M28.5 15.5V24a7.5 7.5 0 0 1-7.5 7.5h-6" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" />
        <path d="m14 13 9 5-9 5V13Z" fill="currentColor" />
      </svg>
      <span>relay<span className="brand-period">.</span></span>
    </span>
  );
}

export function VlcIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 7 17H5L12 3Z" />
      <path d="M9.4 9h5.2M7.3 14h9.4M3 20h18v2H3z" />
    </svg>
  );
}
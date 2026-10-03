/** HODL logo: the melt-line badge plus a geometric wordmark. Ink follows the text color; the accent is --logo-accent. */
export default function Logo({ height = 28 }: { height?: number }) {
  return (
    <svg viewBox="34 50 262 60" height={height} role="img" aria-label="HODL" style={{ display: "block", width: "auto" }}>
      <rect x="38" y="54" width="52" height="52" rx="13" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M48 66L70 94H82" fill="none" stroke="var(--logo-accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(116,60)" fill="none" stroke="currentColor" strokeWidth="7">
        <path d="M3.5 0V40M26.5 0V40M3.5 20H26.5" />
        <circle cx="64" cy="20" r="16.5" />
        <path d="M101.5 3.5H112A16.5 16.5 0 0 1 112 36.5H101.5Z" />
        <path d="M151.5 0V36.5H175" />
      </g>
    </svg>
  );
}

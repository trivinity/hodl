import { hue } from "@/lib/format";

export default function Avatar({ id, symbol, uri, size = 44 }: { id: string; symbol: string; uri?: string; size?: number }) {
  const h = hue(id);
  if (uri && /^https:\/\//.test(uri)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={uri} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" width={size} height={size} className="avatar" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="avatar avatar-gen"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(135deg, hsl(${h} 80% 62%), hsl(${(h + 50) % 360} 85% 48%))`,
      }}
      aria-hidden
    >
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

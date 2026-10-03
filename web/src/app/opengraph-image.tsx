import { ImageResponse } from "next/og";

export const alt = "HODL: tokens that reward holding";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const logo =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="34 50 262 60"><rect x="38" y="54" width="52" height="52" rx="13" fill="none" stroke="#f4f4f5" stroke-width="4"/><path d="M48 66L70 94H82" fill="none" stroke="#ff6b86" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><g transform="translate(116,60)" fill="none" stroke="#f4f4f5" stroke-width="7"><path d="M3.5 0V40M26.5 0V40M3.5 20H26.5"/><circle cx="64" cy="20" r="16.5"/><path d="M101.5 3.5H112A16.5 16.5 0 0 1 112 36.5H101.5Z"/><path d="M151.5 0V36.5H175"/></g></svg>';

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", padding: 96, background: "#0b0b0c", color: "#f4f4f5" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(logo)}`} width={655} height={150} alt="" />
        <div style={{ marginTop: 48, fontSize: 44, color: "#9a9aa5" }}>Tokens that reward holding.</div>
        <div style={{ marginTop: 12, fontSize: 32, color: "#ff6b86" }}>The sell tax melts to zero the longer you hold.</div>
      </div>
    ),
    size
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** bottom navigation on phones (the top menu is hidden there) */
export default function TabBar() {
  const path = usePathname();
  const items: [string, string][] = [
    ["/", "Tokens"],
    ["/create", "Launch"],
    ["/earnings", "Earnings"],
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {items.map(([href, label]) => (
        <Link key={href} href={href} aria-current={(href === "/" ? path === "/" || path.startsWith("/token") : path.startsWith(href)) ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

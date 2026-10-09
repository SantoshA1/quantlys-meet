"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const OPTS = [
  { href: "/preview/a", k: "A", n: "Glass v2" },
  { href: "/preview/b", k: "B", n: "Signal sphere" },
  { href: "/preview/c", k: "C", n: "Spatial workspace" },
];

export default function Switcher() {
  const path = usePathname();
  return (
    <nav className="qp-switch" aria-label="Design directions">
      <span>Preview</span>
      {OPTS.map((o) => (
        <Link key={o.k} href={o.href} className={path === o.href ? "on" : ""} aria-current={path === o.href ? "page" : undefined}>
          <b>{o.k}</b> <span>{o.n}</span>
        </Link>
      ))}
    </nav>
  );
}

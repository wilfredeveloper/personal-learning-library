"use client";

import Link from "next/link";

export default function Nav() {
  return (
    <header className="border-b border-rule">
      <nav className="lib-topnav">
        <Link href="/">Learn</Link>
        <Link href="/learn/history">Questions</Link>
        <Link href="/control">Control room</Link>
      </nav>
    </header>
  );
}

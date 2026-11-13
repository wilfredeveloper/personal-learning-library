import type { Metadata } from "next";
import "./globals.css";
import "./library-theme.css";
import "./reader.css";
import Nav from "@/components/Nav";
import StateSync from "@/components/StateSync";
import LessonNotifier from "@/components/LessonNotifier";

export const metadata: Metadata = {
  title: "Personal Learning Library",
  description:
    "A personal course platform: deliberate, source-grounded studies built lesson by lesson.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&family=Gelasio:ital,wght@0,400;0,600;1,400&display=swap"
        />
      </head>
      <body className="flex min-h-full flex-col">
        <Nav />
        <StateSync />
        <LessonNotifier />
        <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
          {children}
        </main>
        <footer className="border-t border-rule">
          <div className="mx-auto max-w-2xl px-6 py-6 text-sm text-muted">
            Your teacher is one message away — ask for the next lesson, or
            anything that&apos;s unclear.
          </div>
        </footer>
      </body>
    </html>
  );
}

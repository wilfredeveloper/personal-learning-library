import { isLocalRequest, notLocal } from "@/lib/local";
import { ensure, publicHttpUrl, readBody } from "@/lib/external.mjs";

// An external web page, served from the app's own origin so the canvas can lay it beside a
// lesson and read it like a lesson page (highlight -> Explore / Ask, sizing, links). Browsers
// keep another site's page in a frame unreadable, and many sites refuse framing altogether.
// Pages are fetched once and kept (lib/external.mjs); scripts/sync-courses.mjs prefetches every
// link in the published lessons, so most open at once.
//   GET ?url=https://...        -> the page's copy: scripts removed, a <base> pointing back at
//                                  the site so its styles, images and links still resolve there.
//                                  A PDF redirects to /pdf-view.html, which draws it with pdf.js
//                                  (a text layer you can highlight).
//   GET ?url=https://...&raw=1  -> a PDF's bytes, for that viewer.
// Safety: a copy shares the app's origin, so it runs no scripts at all (removed when kept, and
// refused by the Content-Security-Policy below). Only local requests may use the route, and
// only for public http(s) hosts, so it can't be pointed at this machine or its network.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CSP = "script-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'self' http: https:; form-action 'none'";
const APP = process.cwd();

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A small page in place of one that can't open here; its link leaves for a browser tab. */
function failed(url: string, why: string, status = 502) {
  const html = `<!doctype html><meta charset="utf-8"><title>Couldn’t open this page</title>
<body style="font:16px/1.6 Inter,system-ui,sans-serif;color:#19221f;background:#f4f6f2;padding:40px 48px">
<h1 style="font-size:22px;margin:0 0 12px">Couldn’t open this page here</h1>
<p>${esc(why)}</p>
<p><a href="${esc(url)}" data-out="1" target="_blank" rel="noopener">Open it in a new browser tab</a></p></body>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP } });
}

export async function GET(req: Request) {
  if (!isLocalRequest(req)) return notLocal();
  const q = new URL(req.url).searchParams;
  const parsed = publicHttpUrl(q.get("url") ?? "");
  if (!parsed) return failed(q.get("url") ?? "", "Only public http(s) pages can be opened on the canvas.", 400);
  parsed.hash = "";
  const url = parsed.href;

  const meta = await ensure(APP, url);
  if (!meta) return failed(url, "The site couldn’t be reached from this computer just now. Try again in a moment.");
  if (meta.kind === "fail") return failed(url, meta.why ?? "The site didn’t answer properly.");

  if (meta.kind === "pdf") {
    if (q.get("raw") !== "1") return Response.redirect(new URL(`/pdf-view.html?url=${encodeURIComponent(url)}`, req.url), 302);
    const bytes = (await readBody(APP, url, "pdf")) as Buffer | null;
    if (!bytes) return failed(url, "The kept copy of this PDF is missing; it will be fetched again next time.");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=600" } });
  }

  const html = (await readBody(APP, url, "html")) as string | null;
  if (!html) return failed(url, "The kept copy of this page is missing; it will be fetched again next time.");
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP, "Cache-Control": "private, max-age=600" },
  });
}

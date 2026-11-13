// External pages for the canvas: fetch a page once, keep a cleaned copy, and say whether it
// opens on the canvas. Shared by GET /api/page (opening a link), scripts/sync-courses.mjs
// (prefetching every link in the published lessons, and marking each one) and
// scripts/check-links.mjs (the teach skill's link check).
//
// The copy lives in <app>/.cache/pages/<key>.json (what was found) plus <key>.html (the page,
// scripts removed) or <key>.pdf. A verdict per link:
//   open "canvas": an HTML page with real text, or a PDF (the canvas draws it with pdf.js);
//   open "tab":    the site refused, failed, or shows almost nothing without its scripts, so
//                  the link opens in a browser tab instead.
// A network failure on our side (no connection, a timeout) is no verdict: nothing is kept.
//
// Safety: copies are served from the app's own origin, so they must never run scripts; the
// page route also sends a script-blocking Content-Security-Policy. Fetches go only to public
// http(s) hosts, checked again on every redirect. Not covered: a public name that resolves to
// a private address (DNS rebinding).

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";

// Node tries a site's addresses in turn (IPv6, IPv4) and by default drops each one after 250 ms
// without a connection. Far-away servers often take longer (web.stanford.edu: ~0.5 s from here),
// so every attempt failed with "fetch failed" while curl got through. Give each attempt 2 s.
// Process-wide; it only lets slow connections finish.
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);

const MAX_HTML = 5_000_000;
const MAX_PDF = 30_000_000;
const TIMEOUT_MS = 60_000; // the whole fetch, body included: big pages and PDFs on a slow line take a while
const MAX_REDIRECTS = 5;
const MIN_TEXT = 300; // visible characters an HTML page needs to count as readable without scripts
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** The URL if it is http(s) on a public host, else null. */
export function publicHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    (!h.includes(".") && !h.includes(":")) || // bare intranet names
    /^(0|10|127)\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) || // carrier-grade NAT
    h === "::" ||
    h === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(h) ||
    /^fe80:/.test(h) ||
    /^::ffff:/.test(h)
  )
    return null;
  return u;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Strip what could run or navigate on its own, and point relative URLs back at the site. */
function clean(html, base) {
  const out = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/<\/?noscript\b[^>]*>/gi, "") // no scripts will run, so show what the site shows without them
    .replace(/<(iframe|frame|frameset|object|embed|portal)\b[\s\S]*?(<\/\1\s*>|\/>|>)/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "") // refresh redirects, the site's own CSP
    .replace(/<link\b[^>]*rel=["']?(?:preload|modulepreload|prefetch)["']?[^>]*>/gi, "")
    .replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  const head = `<base href="${esc(base)}"><meta charset="utf-8">`;
  return /<head\b[^>]*>/i.test(out) ? out.replace(/<head\b[^>]*>/i, (m) => m + head) : head + out;
}

const decode = (s) =>
  s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " })[m]);

/** Roughly what a reader sees: the body's text without scripts, styles and tags. */
function visibleText(html) {
  const body = html.match(/<body\b[\s\S]*$/i)?.[0] ?? html;
  return decode(
    body
      .replace(/<(script|style|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch an external page.
 * @returns {Promise<
 *   | { kind: "html"; url: string; html: string; title: string }
 *   | { kind: "pdf"; url: string; bytes: Buffer }
 *   | { kind: "fail"; url: string; why: string; status?: number; network?: boolean }>}
 *   url: the final address after redirects. network: the failure was on our side (no verdict).
 */
export async function fetchExternal(raw) {
  let url = publicHttpUrl(raw);
  if (!url) return { kind: "fail", url: raw, why: "Only public http(s) pages can be opened on the canvas." };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res;
    for (let hop = 0; ; hop++) {
      res = await fetch(url, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8" },
      });
      const loc = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !loc) break;
      const next = publicHttpUrl(new URL(loc, url).href);
      if (!next || hop >= MAX_REDIRECTS) return { kind: "fail", url: url.href, why: "The site redirected somewhere this can’t follow." };
      url = next;
    }
    if (!res.ok)
      return { kind: "fail", url: url.href, status: res.status, why: `The site answered ${res.status}${res.statusText ? ` (${res.statusText})` : ""}.` };
    const type = res.headers.get("content-type") ?? "";
    const size = Number(res.headers.get("content-length") ?? 0);
    if (/application\/pdf/i.test(type) || /\.pdf$/i.test(url.pathname) && !/html/i.test(type)) {
      if (size > MAX_PDF) return { kind: "fail", url: url.href, why: "The PDF is too large to open here." };
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_PDF) return { kind: "fail", url: url.href, why: "The PDF is too large to open here." };
      if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { kind: "fail", url: url.href, why: "The site sent something that isn’t a PDF." };
      return { kind: "pdf", url: url.href, bytes };
    }
    if (!/text\/html|application\/xhtml/i.test(type))
      return { kind: "fail", url: url.href, why: `It isn’t a web page or a PDF (${type.split(";")[0] || "unknown type"}).` };
    if (size > MAX_HTML) return { kind: "fail", url: url.href, why: "The page is too large to open here." };
    const text = await res.text();
    if (text.length > MAX_HTML) return { kind: "fail", url: url.href, why: "The page is too large to open here." };
    if (visibleText(text).length < MIN_TEXT)
      return { kind: "fail", url: url.href, why: "The page shows almost nothing without its own scripts, which can’t run here." };
    const title = decode(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
    return { kind: "html", url: url.href, html: clean(text, url.href), title };
  } catch (e) {
    const timeout = e?.name === "AbortError";
    return {
      kind: "fail",
      url: url.href,
      network: true,
      why: timeout ? "The site took too long to answer." : `It couldn’t be fetched (${e?.cause?.code ?? e?.message ?? e}).`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---- the cache ----

export const cacheDir = (appRoot) => path.join(appRoot, ".cache", "pages");
const keyOf = (url) => crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);

/**
 * @typedef {{ url: string; final: string; kind: "html" | "pdf" | "fail"; open: "canvas" | "tab";
 *   title?: string; status?: number; why?: string; fetchedAt: string }} Meta
 */

/** What is kept for a link, or null. */
export async function readMeta(appRoot, url) {
  try {
    return JSON.parse(await fs.readFile(path.join(cacheDir(appRoot), `${keyOf(url)}.json`), "utf8"));
  } catch {
    return null;
  }
}

/** The kept page (cleaned HTML text) or PDF (bytes) for a link, or null. */
export async function readBody(appRoot, url, kind) {
  try {
    const file = path.join(cacheDir(appRoot), `${keyOf(url)}.${kind}`);
    return kind === "html" ? await fs.readFile(file, "utf8") : await fs.readFile(file);
  } catch {
    return null;
  }
}

/** Keep a fetch result. Returns its Meta, or null for a failure on our side (nothing kept). */
export async function store(appRoot, url, r) {
  if (r.kind === "fail" && r.network) return null;
  const dir = cacheDir(appRoot);
  await fs.mkdir(dir, { recursive: true });
  const key = keyOf(url);
  if (r.kind === "html") await fs.writeFile(path.join(dir, `${key}.html`), r.html);
  if (r.kind === "pdf") await fs.writeFile(path.join(dir, `${key}.pdf`), r.bytes);
  /** @type {Meta} */
  const meta = {
    url,
    final: r.url,
    kind: r.kind,
    open: r.kind === "fail" ? "tab" : "canvas",
    ...(r.kind === "html" && r.title ? { title: r.title } : {}),
    ...(r.kind === "fail" ? { why: r.why, ...(r.status ? { status: r.status } : {}) } : {}),
    fetchedAt: new Date().toISOString(),
  };
  const tmp = path.join(dir, `${key}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(meta, null, 1) + "\n");
  await fs.rename(tmp, path.join(dir, `${key}.json`));
  return meta;
}

const DAY = 86_400_000;
/** How long a kept result stands before a link is fetched again: failures are retried sooner. */
export const isFresh = (meta, now = Date.now()) => now - Date.parse(meta.fetchedAt) < (meta.kind === "fail" ? 2 : 30) * DAY;

/** The kept result for a link if fresh, else fetch and keep it. Null when our side failed. */
/** misses, if given, records why a link got no verdict (a failure on our side). */
export async function ensure(appRoot, url, misses) {
  const meta = await readMeta(appRoot, url);
  const kept = async (m) =>
    m.kind === "fail" || (await fs.access(path.join(cacheDir(appRoot), `${keyOf(url)}.${m.kind}`)).then(() => true, () => false));
  if (meta && isFresh(meta) && (await kept(meta))) return meta;
  const r = await fetchExternal(url);
  const got = await store(appRoot, url, r);
  if (!got && r.kind === "fail") misses?.set(url, r.why);
  return got ?? meta; // a network failure keeps any older verdict
}

/** The address a link's href attribute (as written in HTML) is kept under: entities decoded, no #fragment. */
export const linkKey = (href) => decode(href).replace(/#.*$/, "");

/** An external link's opening tag: 1 = before href, 2 = quote, 3 = the href, 4 = after it. */
export const EXTERNAL_A = /<a\b([^>]*?)\bhref\s*=\s*(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi;

/** Every distinct external http(s) link in an HTML file, in order. */
export function externalLinks(html) {
  const out = new Set();
  for (const m of html.matchAll(EXTERNAL_A)) out.add(linkKey(m[3]));
  return [...out];
}

/** Mark each external link with what opening it does: data-open="canvas" (with data-kind="pdf"
    for a PDF) or data-open="tab" plus a title saying why. Links without a verdict stay unmarked. */
export function markLinks(html, metas) {
  return html.replace(EXTERNAL_A, (tag, pre, q, href, post) => {
    if (/\bdata-open\s*=/.test(tag)) return tag;
    const m = metas.get(linkKey(href));
    if (!m) return tag;
    const attrs =
      m.open === "tab"
        ? ` data-open="tab"${/\btitle\s*=/.test(tag) ? "" : ` title="Opens in a browser tab: ${esc(m.why ?? "it can’t be read on the canvas")}"`}`
        : ` data-open="canvas"${m.kind === "pdf" ? ' data-kind="pdf"' : ""}`;
    return `<a${pre}href=${q}${href}${q}${post}${attrs}>`;
  });
}

/** Fetch (or reuse) every external link in some HTML files. metas: url -> Meta for those with a
    verdict; misses: url -> why, for those that couldn't be reached. A slow line is the usual
    cause of misses, so they get one more try, one at a time, after the rest. */
export async function checkAll(appRoot, htmls, { concurrency = 4 } = {}) {
  const urls = [...new Set(htmls.flatMap(externalLinks))];
  const metas = new Map();
  let misses = new Map();
  const one = async (u) => {
    const m = await ensure(appRoot, u, misses);
    if (m) metas.set(u, m);
  };
  await pool(urls, concurrency, one);
  const retry = [...misses.keys()].filter((u) => !metas.has(u));
  misses = new Map();
  await pool(retry, 1, one);
  return { urls, metas, misses };
}

/** Run fn over items, at most n at a time. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

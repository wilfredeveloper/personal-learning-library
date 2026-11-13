// Gate for routes that start or stop local work (lesson jobs). The dev server listens on
// the LAN, so any device there can reach it.
//
// isLocalRequest(req) is true only when
//   1. the Host header's hostname is localhost, 127.0.0.1 or [::1] (any port), and
//   2. if the request carries an Origin header, that origin's hostname is one of those too.
// What it protects against:
//   - a phone or laptop on the LAN opening http://<this-machine-ip>:<port>/ and pressing buttons
//     (its Host is the LAN address);
//   - a web page on another site making the learner's browser POST to http://localhost:<port>/api/...
//     (browsers send Origin on cross-site POSTs, so rule 2 refuses it).
// What it does NOT protect against:
//   - anyone on the LAN who forges the headers on purpose (curl -H "Host: localhost" http://<ip>:<port>/...):
//     both headers are client-supplied and nothing here looks at the socket's real address;
//   - other programs or users on this machine, or a page served from another localhost port;
//   - GET requests without an Origin header from other sites can still reach GET routes (they only read).
// Real isolation needs the server bound to loopback (next dev -H 127.0.0.1).

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const loopbackHost = (hostPort: string) => {
  try {
    return LOOPBACK.has(new URL(`http://${hostPort}`).hostname);
  } catch {
    return false;
  }
};

export function isLocalRequest(req: Request): boolean {
  const host = req.headers.get("host");
  if (!host || !loopbackHost(host)) return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return LOOPBACK.has(new URL(origin).hostname);
  } catch {
    return false; // "null" origins (sandboxed frames, file://) are not ours
  }
}

export const notLocal = () => Response.json({ error: "only from this computer (localhost)" }, { status: 403 });

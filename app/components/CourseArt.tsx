// Cut-paper cover art for a course, drawn as inline SVG. Each known course gets
// its own motif; any other slug gets an abstract composition seeded from the slug.
// The art is a "print", so its colours are fixed and do not follow dark mode.

const P = {
  sheet: "#f1ecdf", // cream backing paper
  white: "#fbf9f3",
  ink: "#19221f",
  blue: "#234be7",
  lime: "#ddf59e",
  coral: "#e0664f",
  sage: "#b9c8b4",
  sand: "#e3d6b8",
  green: "#1f7a4d",
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Motif = (cut: string) => React.ReactNode;

// Token tiles streaming into stacked layers, next-token bars coming out.
const howLlms: Motif = (cut) => {
  const tiles = [
    [70, 150, 86, P.white, -8], [110, 235, 64, P.lime, 5], [60, 310, 100, P.white, -3],
    [190, 190, 70, P.sand, 9], [200, 285, 58, P.blue, -6],
  ] as const;
  return (
    <>
      {tiles.map(([x, y, w, f, rot], i) => (
        <g key={i} filter={cut} transform={`rotate(${rot} ${x + w / 2} ${y + 22})`}>
          <rect x={x} y={y} width={w} height="44" rx="4" fill={f} />
          <path d={`M${x + 12} ${y + 22} h${w - 24}`} stroke={f === P.blue ? P.white : P.ink} strokeOpacity="0.5" strokeWidth="5" strokeLinecap="round" />
        </g>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <g key={i} filter={cut} transform={`rotate(${[-3, 2, -1, 3][i]} 420 ${150 + i * 70})`}>
          <rect x="310" y={120 + i * 70} width="220" height="56" fill={[P.sage, P.white, P.sand, P.ink][i]} />
          {[0, 1, 2, 3, 4].map((j) => (
            <circle key={j} cx={340 + j * 40} cy={148 + i * 70} r="9" fill={i === 3 ? P.lime : (i + j) % 3 === 0 ? P.blue : P.ink} fillOpacity={i === 3 ? 1 : 0.75} />
          ))}
        </g>
      ))}
      <g filter={cut} transform="rotate(2 660 270)">
        <rect x="580" y="120" width="170" height="290" fill={P.white} />
        {[130, 74, 46, 28, 16].map((w, i) => (
          <rect key={i} x="598" y={146 + i * 50} width={w} height="30" fill={i === 0 ? P.coral : P.blue} fillOpacity={i === 0 ? 1 : 0.8 - i * 0.12} />
        ))}
      </g>
    </>
  );
};

const MOTIFS: Record<string, Motif> = {
  "how-llms-work": howLlms,
};

function abstract(slug: string): Motif {
  return function AbstractMotif(cut) {
    const r = rng(hash(slug));
    const fills = [P.sage, P.sand, P.white, P.blue, P.coral, P.lime, P.ink];
    return (
      <>
        {Array.from({ length: 9 }, (_, i) => {
          const x = 90 + r() * 560, y = 70 + r() * 320, w = 70 + r() * 190, h = 50 + r() * 170;
          const fill = fills[Math.floor(r() * fills.length)], rot = (r() - 0.5) * 30;
          return (
            <g key={i} filter={cut} transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`}>
              {r() < 0.35 ? <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} fill={fill} /> : <rect x={x} y={y} width={w} height={h} fill={fill} />}
            </g>
          );
        })}
      </>
    );
  };
}

export default function CourseArt({ slug, title }: { slug: string; title: string }) {
  const id = `art-${slug.replace(/[^a-z0-9]/gi, "")}`;
  const motif = MOTIFS[slug] ?? abstract(slug);
  return (
    <svg className="course-art" viewBox="0 0 800 520" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Cut-paper illustration for ${title}`}>
      <defs>
        {/* paper grain: fibre noise lit from the top-left */}
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed={hash(slug) % 97} result="n" />
          <feDiffuseLighting in="n" lightingColor="#fff" surfaceScale="1.1" result="lit">
            <feDistantLight azimuth="225" elevation="62" />
          </feDiffuseLighting>
          <feComposite in="lit" in2="SourceGraphic" operator="in" />
        </filter>
        {/* a cut sheet: slightly ragged edge, soft shadow underneath */}
        <filter id={`${id}-cut`} x="-10%" y="-10%" width="120%" height="125%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed={hash(slug) % 53} result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale="5" result="edge" />
          <feDropShadow in="edge" dx="2" dy="5" stdDeviation="4" floodColor="#19221f" floodOpacity="0.28" />
        </filter>
      </defs>
      <rect width="800" height="520" fill={P.sheet} />
      {motif(`url(#${id}-cut)`)}
      <rect width="800" height="520" fill="#fff" filter={`url(#${id}-grain)`} opacity="0.5" style={{ mixBlendMode: "multiply" }} />
    </svg>
  );
}

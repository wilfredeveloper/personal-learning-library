// katex 0.16.11 ships without TypeScript types; this declares only what lib/mathMarkdown.ts uses.
declare module "katex" {
  const katex: {
    renderToString(tex: string, options?: { displayMode?: boolean; throwOnError?: boolean; output?: "html" | "mathml" | "htmlAndMathml" }): string;
  };
  export default katex;
}

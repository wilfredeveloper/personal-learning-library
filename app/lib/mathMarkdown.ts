import katex from "katex";
import { marked } from "marked";

// Markdown with LaTeX maths, for tutor text on the canvas. $$…$$ and \[…\] are display
// equations, $…$ and \(…\) inline. Maths is typeset first and parked behind placeholder
// tokens so marked can't mangle the TeX (underscores, asterisks), then put back.
// While a card is still streaming, an unclosed $ or $$ simply stays as text until its
// closing delimiter arrives. Prices like "$5 and $10" are not maths: an inline $…$ must not
// start or end with a space, and the closing $ must not be followed by a digit or letter.

const tex = (src: string, displayMode: boolean) =>
  // with the MathML half (hidden by the KaTeX stylesheet): it keeps the TeX source, so a
  // highlight over a formula on the canvas is read back as $TeX$ (see rangeText in LessonCanvas)
  katex.renderToString(src.trim(), { displayMode, throwOnError: false, output: "htmlAndMathml" });

export function markdownWithMath(src: string): string {
  const slots: string[] = [];
  const park = (html: string) => `KXSLOT${slots.push(html) - 1}KXEND`;
  const text = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t: string) => park(tex(t, true)))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t: string) => park(tex(t, true)))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t: string) => park(tex(t, false)))
    .replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, (_, pre: string, t: string) => pre + park(tex(t, false)));
  const html = marked.parse(text, { async: false }) as string;
  return html.replace(/KXSLOT(\d+)KXEND/g, (_, i: string) => slots[Number(i)] ?? "");
}

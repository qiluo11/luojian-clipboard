/** Strip copied foreground/background paint without discarding typography or structure.
 * This transforms display/paste copies only; stored clipboard HTML remains unchanged.
 */
const COLOR_PROPERTIES = new Set([
  "color", "background", "background-color", "background-image", "border-color",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "outline-color", "text-shadow", "box-shadow", "caret-color", "fill", "stroke",
  "-webkit-text-fill-color", "-webkit-text-stroke-color", "text-decoration-color",
  "column-rule-color", "mso-highlight", "mso-shading"
]);

const stripStyle = (style: CSSStyleDeclaration) => {
  for (const name of Array.from(style)) {
    if (COLOR_PROPERTIES.has(name.toLowerCase())) style.removeProperty(name);
  }
};

export const stripRichTextDocumentColors = (doc: Document): void => {
  doc.querySelectorAll<HTMLElement>("*").forEach(el => {
    for (const name of ["color", "bgcolor", "bordercolor", "text", "link", "vlink", "alink"]) {
      el.removeAttribute(name);
    }
    if (el.style) {
      stripStyle(el.style);
      if (!el.style.length) el.removeAttribute("style");
    }
  });
  doc.querySelectorAll("style").forEach(el => {
    try {
      // Detached CSSOM: understands comments, quoted delimiters and nested @media;
      // never attach the source stylesheet to the application during processing.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(el.textContent || "");
      const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if ("style" in rule) stripStyle((rule as CSSStyleRule).style);
          if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
        }
      };
      visit(sheet.cssRules);
      el.textContent = Array.from(sheet.cssRules, rule => rule.cssText).join("\n");
    } catch {
      // Older WebViews: prefer readable semantic HTML to unsanitized paint rules.
      el.remove();
    }
  });
};

export type PreviewPalette = { foreground: string; background: string };
export const readPreviewPalette = (): PreviewPalette => {
  if (typeof document === "undefined") return { foreground: "#24292e", background: "#ffffff" };
  const style = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    return value && CSS.supports("color", value) ? value : fallback;
  };
  return {
    foreground: color("--text-primary", "#24292e"),
    background: color("--bg-panel", "#ffffff")
  };
};

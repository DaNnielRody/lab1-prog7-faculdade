import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --${name} not found in app/globals.css`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

describe("design tokens exist", () => {
  const required = [
    "color-rail",
    "color-canvas",
    "color-text",
    "color-text-secondary",
    "color-brand",
    "color-brand-text",
    "color-success",
    "color-danger",
    "color-info",
    "color-focus",
    "radius-sm",
    "radius-md",
    "radius-lg",
    "text-body",
    "text-mono",
  ];

  it.each(required)("declares --%s", (name) => {
    expect(css).toContain(`--${name}:`);
  });

  it("declares exactly the three named radii from docs/DESIGN.md §6 (rounded-full is built in)", () => {
    const radii = [...css.matchAll(/--radius-([a-z]+):/g)].map((m) => m[1]);
    expect(radii.sort()).toEqual(["lg", "md", "sm"]);
  });
});

describe("measured contrast (docs/DESIGN.md §2)", () => {
  it("text on canvas is 17.89:1", () => {
    expect(contrast(token("color-text"), token("color-canvas"))).toBe(17.89);
  });

  it("secondary text clears AA on both light surfaces", () => {
    expect(contrast(token("color-text-secondary"), token("color-canvas"))).toBe(5.29);
    expect(contrast(token("color-text-secondary"), token("color-surface-muted"))).toBe(4.93);
  });

  it("brand orange is a graphic-only value: 3.12:1 on canvas, below the 4.5 text floor", () => {
    expect(contrast(token("color-brand"), token("color-canvas"))).toBe(3.12);
    expect(contrast(token("color-brand"), token("color-canvas"))).toBeGreaterThanOrEqual(3);
  });

  it("brand text orange clears AA on canvas, on the orange wash and on muted", () => {
    expect(contrast(token("color-brand-text"), token("color-canvas"))).toBe(5.99);
    expect(contrast(token("color-brand-text"), token("color-brand-soft"))).toBe(5.43);
    expect(contrast(token("color-brand-text"), token("color-surface-muted"))).toBe(5.59);
  });

  it("the ink label is legal on the brand fill in BOTH resting and pressed states", () => {
    expect(contrast(token("color-text"), token("color-brand"))).toBe(5.74);
    expect(contrast(token("color-text"), token("color-brand-pressed"))).toBe(4.78);
    expect(contrast(token("color-text"), token("color-brand-pressed"))).toBeGreaterThanOrEqual(4.5);
  });

  it("white on the brand fill would fail AA — this is why the label is ink", () => {
    expect(contrast(token("color-text-inverse"), token("color-brand"))).toBeLessThan(4.5);
  });

  it("semantic colors clear AA on their own soft tints", () => {
    expect(contrast(token("color-success"), token("color-success-soft"))).toBe(5.29);
    expect(contrast(token("color-danger"), token("color-danger-soft"))).toBe(5.03);
    expect(contrast(token("color-info"), token("color-info-soft"))).toBe(6.35);
    expect(contrast(token("color-warning"), token("color-warning-soft"))).toBe(5.38);
  });

  it("rail text and rail muted clear AA on the rail", () => {
    expect(contrast(token("color-rail-text"), token("color-rail"))).toBe(17.24);
    expect(contrast(token("color-rail-muted"), token("color-rail"))).toBe(6.91);
  });

  it("the focus ring pair clears 3:1 on each surface family (SC 1.4.11)", () => {
    expect(contrast(token("color-focus"), token("color-canvas"))).toBe(5.99);
    expect(contrast(token("color-focus-dark"), token("color-rail"))).toBe(8.4);
  });

  it("the disabled grey is below AA — it is reserved for disabled controls only", () => {
    expect(contrast(token("color-text-disabled"), token("color-canvas"))).toBe(2.79);
  });
});

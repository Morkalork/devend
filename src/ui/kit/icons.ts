import { Texture } from "pixi.js";
import type { LucideIcon } from "lucide-react";
import { RESOLUTION } from "./style";

/**
 * An icon is either a lucide-react component - the same import the DOM
 * interface uses, so every existing icon map (goalIcons, upgradeIcons, the
 * ability glyphs) works on the canvas unchanged - or a raw node.
 */
export type IconSource = IconNode | LucideIcon;

/** An icon's SVG elements: [tag, attributes] pairs, lucide's own shape. */
export type IconNode = [string, Record<string, string | number>][];

const nodeCache = new WeakMap<object, IconNode>();

/**
 * The SVG elements behind an icon. A lucide-react icon is a forwardRef whose
 * render returns its base element with `icon.node` (1.x) or `iconNode` (0.x)
 * in its props; calling the render function reads them without rendering
 * anything.
 */
export function iconNodeOf(icon: IconSource): IconNode {
  if (Array.isArray(icon)) return icon;
  const cached = nodeCache.get(icon as object);
  if (cached) return cached;
  let node: IconNode = [];
  try {
    const render = (icon as unknown as { render?: (p: object, r: null) => { props?: Record<string, unknown> } }).render;
    const props = render?.({}, null)?.props ?? {};
    node = ((props.icon as { node?: IconNode } | undefined)?.node ?? props.iconNode ?? []) as IconNode;
  } catch { /* not a lucide icon */ }
  nodeCache.set(icon as object, node);
  return node;
}

/**
 * Icons are rasterised by the browser's own SVG renderer, once per icon,
 * colour and size, into a texture. Pixi's SVG path parser rejects lucide's
 * compact arc syntax ("a2 2 0 012-2"), and the browser never does.
 */
const iconCache = new Map<string, Promise<Texture>>();

function iconSvg(node: IconNode, color: number, strokeWidth: number, px: number): string {
  const c = `#${color.toString(16).padStart(6, "0")}`;
  const body = node.map(([tag, attrs]) => {
    const a = Object.entries(attrs as Record<string, string | number>)
      .filter(([k]) => k !== "key")
      .map(([k, v]) => `${k}="${v}"`).join(" ");
    return `<${tag} ${a}/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" `
    + `stroke="${c}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export function iconTexture(icon: IconSource, color: number, size: number, strokeWidth = 2): Promise<Texture> {
  const node = iconNodeOf(icon);
  const px = Math.max(1, Math.round(size * RESOLUTION));
  const key = `${JSON.stringify(node)}|${color}|${px}|${strokeWidth}`;
  let tex = iconCache.get(key);
  if (!tex) {
    tex = new Promise<Texture>((resolve) => {
      const img = new Image(px, px);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = px; canvas.height = px;
        canvas.getContext("2d")?.drawImage(img, 0, 0, px, px);
        resolve(Texture.from(canvas));
      };
      img.onerror = () => resolve(Texture.EMPTY);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(node, color, strokeWidth, px))}`;
    });
    iconCache.set(key, tex);
  }
  return tex;
}


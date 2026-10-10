import { Texture } from "pixi.js";
import type { IconNode } from "lucide";
import { RESOLUTION } from "./style";

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

export function iconTexture(node: IconNode, color: number, size: number, strokeWidth = 2): Promise<Texture> {
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


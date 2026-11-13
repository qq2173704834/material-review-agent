import { imageProjector, type ImagePoint } from "@/lib/perspective";
import "server-only";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import type * as PdfJs from "pdfjs-dist";

export interface ImageProcessing {
  corners?: ImagePoint[];
  rotateDegrees: number;
  normalize: boolean;
  sharpen: boolean;
}
export async function processMaterialImage(
  buffer: Buffer,
  processing?: ImageProcessing,
): Promise<Buffer> {
  let input = buffer;
  if (processing?.corners) {
    const map = imageProjector(processing.corners);
    const raw = await sharp(buffer, { limitInputPixels: 25_000_000 })
      .autoOrient()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = raw.info;
    const points = processing.corners;
    const distance = (first: ImagePoint, second: ImagePoint): number =>
      Math.hypot((first.x - second.x) * width, (first.y - second.y) * height);
    const targetWidth = Math.max(
      2,
      Math.min(
        2048,
        Math.round((distance(points[0]!, points[1]!) + distance(points[3]!, points[2]!)) / 2),
      ),
    );
    const targetHeight = Math.max(
      2,
      Math.min(
        2048,
        Math.round((distance(points[0]!, points[3]!) + distance(points[1]!, points[2]!)) / 2),
      ),
    );
    const output = Buffer.alloc(targetWidth * targetHeight * channels);
    for (let y = 0; y < targetHeight; y++)
      for (let x = 0; x < targetWidth; x++) {
        const point = map(x / (targetWidth - 1), y / (targetHeight - 1));
        const sx = Math.max(0, Math.min(width - 1, Math.round(point.x * (width - 1)))),
          sy = Math.max(0, Math.min(height - 1, Math.round(point.y * (height - 1))));
        for (let channel = 0; channel < channels; channel++)
          output[(y * targetWidth + x) * channels + channel] =
            raw.data[(sy * width + sx) * channels + channel]!;
      }
    input = await sharp(output, { raw: { width: targetWidth, height: targetHeight, channels } })
      .png()
      .toBuffer();
  }
  let image = sharp(input, { limitInputPixels: 25_000_000 })
    .autoOrient()
    .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true });
  if (processing?.rotateDegrees)
    image = image.rotate(processing.rotateDegrees, { background: "white" });
  if (processing?.normalize)
    image = image.normalize({ lower: 1, upper: 99 }).clahe({ width: 32, height: 32, maxSlope: 3 });
  if (processing?.sharpen) image = image.sharpen({ sigma: 1 });
  return image.png().toBuffer();
}
let activeRenders = 0;
export async function renderMaterialImage(
  buffer: Buffer,
  extension: string,
  pageNumber: number,
  processing?: ImageProcessing,
): Promise<Buffer> {
  if (activeRenders >= 2) throw new Error("图像预览繁忙，请稍后重试。");
  activeRenders++;
  try {
    if (["png", "jpg", "jpeg"].includes(extension)) {
      if (pageNumber !== 1) throw new Error("图片只有一页。");
      return await processMaterialImage(buffer, processing);
    }
    if (extension !== "pdf") throw new Error("仅支持图片与PDF页图。");
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof PdfJs;
    const loading = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    const timer = setTimeout(() => void loading.destroy().catch(() => undefined), 30_000);
    try {
      const document = await loading.promise;
      if (pageNumber < 1 || pageNumber > Math.min(document.numPages, 200))
        throw new Error("页码超出范围。");
      const page = await document.getPage(pageNumber),
        base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        2,
        4096 / Math.max(base.width, base.height),
        Math.sqrt(8_000_000 / (base.width * base.height)),
      );
      if (!Number.isFinite(scale) || scale <= 0) throw new Error("页面尺寸无效。");
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.max(1, Math.floor(viewport.width)),
        Math.max(1, Math.floor(viewport.height)),
      );
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      return canvas.toBuffer("image/png");
    } finally {
      clearTimeout(timer);
      await loading.destroy();
    }
  } finally {
    activeRenders--;
  }
}

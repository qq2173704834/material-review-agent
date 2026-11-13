import "server-only";
import sharp from "sharp";
export async function imageVisualHints(
  buffer: Buffer,
): Promise<Array<{ text: string; location: string }>> {
  const { data, info } = await sharp(buffer)
    .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  let minX = info.width,
    minY = info.height,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      const red = data[offset] ?? 0,
        green = data[offset + 1] ?? 0,
        blue = data[offset + 2] ?? 0;
      if (red > 110 && red > green * 1.4 && red > blue * 1.4) {
        count++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  const ratio = count / (info.width * info.height);
  return count >= 30 && ratio <= 0.3
    ? [
        {
          text: "图像中检测到局部红色图形，可作为疑似签章的人工查看线索；也可能是装饰、文字或其他图形。此线索不确认签章存在、完整性或真实性；未检测到线索也不表示无签章。",
          location: `图像辅助区域 · 归一化${info.width}×${info.height} · x=${minX}–${maxX}, y=${minY}–${maxY}`,
        },
      ]
    : [];
}

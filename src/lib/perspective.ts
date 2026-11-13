export interface ImagePoint {
  x: number;
  y: number;
}
export function validImageCorners(points: ImagePoint[]): boolean {
  if (
    points.length !== 4 ||
    points.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1,
    )
  )
    return false;
  return points.every((point, index) => {
    const next = points[(index + 1) % 4]!,
      following = points[(index + 2) % 4]!;
    return (
      (next.x - point.x) * (following.y - next.y) - (next.y - point.y) * (following.x - next.x) >
      0.002
    );
  });
}
/** Inverse projective map: output unit rectangle -> user-confirmed source quadrilateral. */
export function projectImagePoint(points: ImagePoint[], u: number, v: number): ImagePoint {
  return imageProjector(points)(u, v);
}
export function imageProjector(points: ImagePoint[]): (u: number, v: number) => ImagePoint {
  // Solve once outside the pixel loop.
  if (!validImageCorners(points)) throw new Error("四角无效。");
  const [p0, p1, p2, p3] = points as [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
  const dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y,
    dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(denominator) < 1e-8) throw new Error("四角退化。");
  const g = (dx3 * dy2 - dx2 * dy3) / denominator,
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  const a = p1.x - p0.x + g * p1.x,
    b = p3.x - p0.x + h * p3.x,
    d = p1.y - p0.y + g * p1.y,
    e = p3.y - p0.y + h * p3.y;
  return (u: number, v: number): ImagePoint => {
    const denominator = g * u + h * v + 1;
    return { x: (a * u + b * v + p0.x) / denominator, y: (d * u + e * v + p0.y) / denominator };
  };
}

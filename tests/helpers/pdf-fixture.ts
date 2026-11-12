import { createCanvas } from "@napi-rs/canvas";

/** Actual image-only and mixed PDFs, with deterministic text suitable for OCR. */
export function createReviewPdf(pages: Array<"text" | "scan" | "blank">): Buffer {
  const canvas = createCanvas(1200, 500);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1200, 500);
  context.fillStyle = "black";
  context.font = "48px Arial";
  context.fillText("Project name: GREEN ENERGY", 60, 100);
  context.fillText("Budget total: 12000", 60, 200);
  const jpeg = canvas.toBuffer("image/jpeg");
  const objects: Buffer[] = [];
  const ascii = (text: string): Buffer => Buffer.from(text, "ascii");
  const stream = (header: string, data: Buffer): Buffer =>
    Buffer.concat([
      ascii("<< " + header + " /Length " + data.length + " >>\nstream\n"),
      data,
      ascii("\nendstream"),
    ]);
  objects.push(ascii("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(
    ascii(
      "<< /Type /Pages /Kids [" +
        pages.map((_, index) => 5 + index * 2 + " 0 R").join(" ") +
        "] /Count " +
        pages.length +
        " >>",
    ),
  );
  objects.push(ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  objects.push(
    stream(
      "/Type /XObject /Subtype /Image /Width 1200 /Height 500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
      jpeg,
    ),
  );
  pages.forEach((kind, index) => {
    objects.push(
      ascii(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 250] /Resources << /Font << /F1 3 0 R >> /XObject << /Image1 4 0 R >> >> /Contents " +
          (6 + index * 2) +
          " 0 R >>",
      ),
    );
    objects.push(
      stream(
        "",
        ascii(
          kind === "text"
            ? "BT /F1 20 Tf 30 200 Td (Native project description) Tj ET"
            : kind === "scan"
              ? "q 600 0 0 250 0 0 cm /Image1 Do Q"
              : "",
        ),
      ),
    );
  });
  const chunks = [ascii("%PDF-1.4\n")];
  const offsets = [0];
  let length = chunks[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([ascii(index + 1 + " 0 obj\n"), object, ascii("\nendobj\n")]);
    chunks.push(chunk);
    length += chunk.length;
  });
  chunks.push(
    ascii(
      "xref\n0 " +
        (objects.length + 1) +
        "\n0000000000 65535 f \n" +
        offsets
          .slice(1)
          .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
          .join("") +
        "trailer\n<< /Size " +
        (objects.length + 1) +
        " /Root 1 0 R >>\nstartxref\n" +
        length +
        "\n%%EOF",
    ),
  );
  return Buffer.concat(chunks);
}

export function createOcrImage(): Buffer {
  const canvas = createCanvas(1400, 350);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1400, 350);
  context.fillStyle = "black";
  context.font = "52px Microsoft YaHei";
  context.fillText("项目名称：绿色能源计划", 60, 100);
  context.fillText("Budget total: 12000", 60, 220);
  return canvas.toBuffer("image/png");
}

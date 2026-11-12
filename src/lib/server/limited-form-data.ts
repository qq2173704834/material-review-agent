import "server-only";

const MAXIMUM_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export class MultipartSizeLimitError extends Error {}

export async function readLimitedFormData(
  request: Request,
  maximumFileBytes: number,
): Promise<FormData> {
  const maximumRequestBytes = maximumFileBytes + MAXIMUM_MULTIPART_OVERHEAD_BYTES;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumRequestBytes)
    throw new MultipartSizeLimitError("上传请求超过允许大小。");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("上传请求为空。");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumRequestBytes) {
        await reader.cancel();
        throw new MultipartSizeLimitError("上传请求超过允许大小。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  }).formData();
}

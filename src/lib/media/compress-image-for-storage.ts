import sharp from "sharp";

/** Compress only when the file is “heavy” or very large in pixels; output is readable JPEG, not aggressive. */
const BYTES_HEAVY = 900 * 1024; // ~900 KiB
const MAX_LONG_EDGE = 2560;
const JPEG_QUALITY = 87;

/**
 * PDFs and non-images pass through unchanged.
 * Heavy/large images: auto-orient, optional downscale (long edge), encode as mozjpeg ~87 (readable receipts).
 */
export async function maybeCompressImageForStorage(
  buffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!mimeType.startsWith("image/")) {
    return { buffer, mimeType };
  }

  try {
    const meta = await sharp(buffer, { failOn: "truncated" }).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const longEdge = Math.max(w, h);
    const heavy = buffer.byteLength > BYTES_HEAVY;
    const tooWide = longEdge > MAX_LONG_EDGE;

    if (!heavy && !tooWide) {
      return { buffer, mimeType };
    }

    let pipeline = sharp(buffer).rotate();

    if (tooWide) {
      pipeline = pipeline.resize({
        width: MAX_LONG_EDGE,
        height: MAX_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    if (meta.hasAlpha) {
      pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    const out = await pipeline
      .jpeg({
        quality: JPEG_QUALITY,
        mozjpeg: true,
      })
      .toBuffer();

    if (out.byteLength >= buffer.byteLength && buffer.byteLength < BYTES_HEAVY * 2) {
      return { buffer, mimeType };
    }

    return { buffer: out, mimeType: "image/jpeg" };
  } catch {
    return { buffer, mimeType };
  }
}

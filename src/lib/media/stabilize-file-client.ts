/** Read a File into memory so later disk/iCloud changes cannot abort the upload. */
export async function stabilizeFile(file: File): Promise<File> {
  const buffer = await file.arrayBuffer();
  return new File([buffer], file.name || "upload", {
    type: file.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

const CLIENT_HEAVY_BYTES = 1_200_000;
const CLIENT_MAX_LONG_EDGE = 2048;
const CLIENT_JPEG_QUALITY = 0.85;

/**
 * Downscale heavy camera photos in the browser before upload so LTE / tunnel
 * posts stay smaller. PDFs and already-small images pass through unchanged.
 */
export async function maybeCompressImageForUpload(file: File): Promise<File> {
  const mime = (file.type || "").toLowerCase();
  if (!mime.startsWith("image/") || mime === "image/gif") {
    return stabilizeFile(file);
  }

  const stabilized = await stabilizeFile(file);
  if (stabilized.size <= CLIENT_HEAVY_BYTES) {
    return stabilized;
  }

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return stabilized;
  }

  try {
    const bitmap = await createImageBitmap(stabilized);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > CLIENT_MAX_LONG_EDGE ? CLIENT_MAX_LONG_EDGE / longEdge : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return stabilized;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/jpeg", CLIENT_JPEG_QUALITY);
    });
    if (!blob || blob.size >= stabilized.size) {
      return stabilized;
    }

    const baseName = stabilized.name.replace(/\.[^.]+$/, "") || "upload";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return stabilized;
  }
}

export async function prepareOutgoingFiles(files: File[]): Promise<File[]> {
  const prepared: File[] = [];
  for (const file of files) {
    prepared.push(await maybeCompressImageForUpload(file));
  }
  return prepared;
}

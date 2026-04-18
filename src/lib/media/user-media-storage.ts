import { createHash } from "crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "fs/promises";
import path from "path";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function getUserMediaRoot(): string {
  const raw = process.env.MEDIA_STORAGE_DIR?.trim();
  if (raw) return path.resolve(raw);
  return path.join(process.cwd(), "storage", "user-media");
}

export function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "application/pdf") return ".pdf";
  if (m === "image/png") return ".png";
  if (m === "image/jpeg" || m === "image/jpg") return ".jpg";
  if (m === "image/webp") return ".webp";
  if (m === "image/gif") return ".gif";
  if (m === "image/heic" || m === "image/heif") return ".heic";
  return ".bin";
}

function resolveUnderMediaRoot(relativePath: string): string | null {
  const root = path.resolve(getUserMediaRoot());
  const joined = path.resolve(path.join(root, ...relativePath.split("/")));
  if (!joined.startsWith(root + path.sep) && joined !== root) {
    return null;
  }
  return joined;
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sanitizeOriginalFilename(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ()\u00C0-\u024F]+/g, "_");
  return base.slice(0, 200) || "upload";
}

/** Reject obviously unsafe uploads; chat already limits accept types client-side. */
export function assertAllowedChatMime(mime: string): void {
  const m = mime.toLowerCase();
  if (m === "application/pdf") return;
  if (m.startsWith("image/")) return;
  throw new Error("Only images and PDF files can be stored.");
}

export function assertUploadSize(byteLength: number): void {
  if (byteLength <= 0) throw new Error("Empty file.");
  if (byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`Each file must be at most ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`);
  }
}

export async function writeUserMediaFile(
  userId: string,
  id: string,
  mimeType: string,
  buffer: Buffer,
): Promise<string> {
  assertUploadSize(buffer.byteLength);
  assertAllowedChatMime(mimeType);
  const root = getUserMediaRoot();
  const userDir = path.join(root, userId);
  await mkdir(userDir, { recursive: true });
  const ext = extForMime(mimeType);
  const filename = `${id}${ext}`;
  const full = path.join(userDir, filename);
  await writeFile(full, buffer);
  return path.join(userId, filename).replace(/\\/g, "/");
}

export async function readUserMediaFile(relativePath: string): Promise<Buffer | null> {
  const full = resolveUnderMediaRoot(relativePath);
  if (!full) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

/** Remove all stored bytes for a user (used before ZIP restore). */
export async function removeUserMediaDirectory(userId: string): Promise<void> {
  const root = getUserMediaRoot();
  const dir = path.join(root, userId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export async function unlinkUserMediaRelative(relativePath: string): Promise<void> {
  const full = resolveUnderMediaRoot(relativePath);
  if (!full) return;
  try {
    await unlink(full);
  } catch {
    /* ignore */
  }
}

import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

import { getUserMediaRoot } from "@/lib/media/user-media-storage";

/** Sibling of `user-media`: `{parent}/user-avatars/{userId}/avatar.jpg` */
export function getAvatarFilePath(userId: string): string {
  const storageDir = path.dirname(getUserMediaRoot());
  return path.join(storageDir, "user-avatars", userId, "avatar.jpg");
}

export async function readAvatarBuffer(userId: string): Promise<Buffer | null> {
  const full = getAvatarFilePath(userId);
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

export async function removeAvatarFiles(userId: string): Promise<void> {
  const dir = path.dirname(getAvatarFilePath(userId));
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const MAX_AVATAR_UPLOAD = 8 * 1024 * 1024;

/** Square-crop, max edge 384px, readable JPEG. */
export async function writeAvatarFromUpload(userId: string, fileBuffer: Buffer): Promise<string> {
  if (fileBuffer.byteLength > MAX_AVATAR_UPLOAD) {
    throw new Error("Image must be at most 8 MB.");
  }

  const outDir = path.dirname(getAvatarFilePath(userId));
  await mkdir(outDir, { recursive: true });

  const jpeg = await sharp(fileBuffer)
    .rotate()
    .resize(384, 384, { fit: "cover", position: "centre" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const dest = getAvatarFilePath(userId);
  await writeFile(dest, jpeg);
  return path.join(userId, "avatar.jpg").replace(/\\/g, "/");
}

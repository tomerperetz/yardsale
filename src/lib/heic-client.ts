'use client'

/**
 * Client-side HEIC handling — layer 2 of a three-layer plan (see
 * task-18-report.md for the full reasoning):
 *
 *  1. iOS Safari already transcodes HEIC to JPEG for a plain <input
 *     accept="image/*"> (see PhotoDrop.tsx / BulkQueue.tsx for why that
 *     attribute must never be narrowed to an explicit HEIC MIME/extension —
 *     doing so hands back the original HEIC instead of iOS's own JPEG).
 *  2. This module: when a HEIC file still arrives (non-Safari browsers,
 *     or a picker that bypassed the transcode), convert it in the browser
 *     using the platform's own HEIC decoder via createImageBitmap + canvas.
 *  3. If that fails or isn't available, the file is returned unconverted
 *     and the upload proceeds as-is — the server's existing per-file HEIC
 *     error (src/app/api/upload/route.ts) is the final fallback. sharp on
 *     this build parses a HEIC container's metadata fine but fails at
 *     decode time, so this must never be "fixed" by pre-checking metadata
 *     client-side — only an actual decode attempt tells the truth.
 */

function looksLikeHeic(file: File): boolean {
  const type = file.type.toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  // Some browsers report no MIME type at all for HEIC; fall back to the extension.
  return /\.hei[cf]$/i.test(file.name)
}

/**
 * Returns a JPEG File when `file` looks like HEIC/HEIF and this browser can
 * decode it locally; otherwise returns `file` unchanged. Never throws —
 * any failure (unsupported API, a HEIC variant the browser itself can't
 * decode either) falls through to returning the original file so the
 * caller can still attempt the upload and let the server's error surface.
 */
export async function convertHeicIfNeeded(file: File): Promise<File> {
  if (!looksLikeHeic(file)) return file
  if (typeof createImageBitmap !== 'function') return file

  try {
    const bitmap = await createImageBitmap(file)
    try {
      const canvas = document.createElement('canvas')
      // Never upscale — the canvas is exactly the source's own pixel size.
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(bitmap, 0, 0)

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      if (!blob) return file

      const convertedName = file.name.replace(/\.hei[cf]$/i, '') + '.jpg'
      return new File([blob], convertedName, { type: 'image/jpeg', lastModified: file.lastModified })
    } finally {
      bitmap.close()
    }
  } catch {
    return file
  }
}

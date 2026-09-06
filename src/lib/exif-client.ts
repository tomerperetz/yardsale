'use client'

import exifr from 'exifr'

/** EXIF DateTimeOriginal, or null when the file carries no usable timestamp. */
export async function readTakenAt(file: File): Promise<Date | null> {
  try {
    const parsed = await exifr.parse(file, ['DateTimeOriginal'])
    return parsed?.DateTimeOriginal ?? null
  } catch {
    return null
  }
}

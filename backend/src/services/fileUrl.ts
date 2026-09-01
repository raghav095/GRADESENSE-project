import path from 'path';

/**
 * The uploaded file's absolute server path is never sent to the client —
 * only its public URL under the static /uploads mount (see server.ts), so
 * the original PDF (with any diagrams/images it contains, which the
 * text-only grading pipeline never sees) can still be opened and viewed
 * directly by a teacher.
 */
export function toPublicFileUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  return `/uploads/${path.basename(filePath)}`;
}

import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { HttpError } from './http.js';

// Client logos live on local disk under api/storage/logos. Names are random, so a logo URL
// cannot be guessed from a client id, and they are served with headers that stop an
// uploaded SVG from ever running script.

// api/storage by default; STORAGE_DIR moves it (the worker writes reports to the same place).
export const STORAGE_DIR =
  process.env.STORAGE_DIR ?? fileURLToPath(new URL('../storage/', import.meta.url));
export const LOGO_DIR = join(STORAGE_DIR, 'logos');
export const REPORTS_DIR = join(STORAGE_DIR, 'reports');
export const MAX_LOGO_BYTES = 1024 * 1024;
const NAME = /^[0-9a-f-]{36}-[A-Za-z0-9_-]{16}\.(png|jpg|svg)$/;

type Kind = 'png' | 'jpg' | 'svg';

// Trust the bytes, not the file name or the browser's Content-Type.
export function sniffImage(buf: Buffer): Kind | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  const head = buf.subarray(0, 1024).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    return 'svg';
  }
  return null;
}

// Defence in depth: the serving headers already sandbox SVG, but a logo is only shapes
// and colours. Anything that can run code, pull in another resource or hide what it is
// (character references, entities) is refused outright rather than cleaned.
export function svgProblem(svg: string): string | null {
  if (/<script[\s/>]/i.test(svg)) return 'SVG logos cannot contain scripts';
  // Attribute names can follow a slash as well as a space: <g/onload=...>.
  if (/(^|[^a-z0-9_:-])on[a-z]+\s*=/i.test(svg)) return 'SVG logos cannot contain event handlers';
  if (/javascript:/i.test(svg)) return 'SVG logos cannot contain javascript: links';
  if (/&#|<!ENTITY/i.test(svg)) return 'SVG logos cannot contain character references or entities';
  if (/<(foreignObject|iframe|embed|object)[\s/>]/i.test(svg)) return 'SVG logos cannot embed HTML';
  // Only links to something inside the same file (#gradient) are allowed. Quotes are
  // matched explicitly: an optional quote would let the engine count the quote itself as
  // the first character of the value, and refuse href="#g".
  if (/(?:xlink:)?href\s*=\s*(?:"\s*(?!#)|'\s*(?!#)|(?!["'\s#]))/i.test(svg)) {
    return 'SVG logos cannot link to other files';
  }
  if (/url\(\s*(?:"\s*(?!#)|'\s*(?!#)|(?!["'\s#]))/i.test(svg)) {
    return 'SVG logos cannot load other files';
  }
  return null;
}

export async function saveLogo(clientId: string, buf: Buffer) {
  if (buf.length > MAX_LOGO_BYTES) throw new HttpError(400, 'Logos must be 1 MB or smaller');
  const kind = sniffImage(buf);
  if (!kind) throw new HttpError(400, 'Upload a PNG, JPG or SVG image');
  if (kind === 'svg') {
    const problem = svgProblem(buf.toString('utf8'));
    if (problem) throw new HttpError(400, problem);
  }
  await mkdir(LOGO_DIR, { recursive: true });
  const name = `${clientId}-${randomBytes(12).toString('base64url')}.${kind}`;
  await writeFile(join(LOGO_DIR, name), buf);
  return name;
}

export async function deleteLogo(name: string | null) {
  if (!name || !NAME.test(name)) return;
  await unlink(join(LOGO_DIR, name)).catch(() => undefined);
}

export const logoUrl = (name: string | null) => (name ? `/api/files/logos/${name}` : null);

// Public: logos appear on status pages that anyone can open.
export function filesRouter() {
  const router = Router();
  router.get('/logos/:name', (req, res) => {
    const name = String(req.params.name);
    if (!NAME.test(name)) throw new HttpError(404, 'Not found');
    res.set({
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400, immutable',
      // Status pages on a client's own domain load these from ours.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.sendFile(name, { root: LOGO_DIR }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Not found' });
    });
  });
  return router;
}

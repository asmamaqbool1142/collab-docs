import path from 'node:path';
import mammoth from 'mammoth';
import { marked } from 'marked';
import { HttpError } from './errors.js';
import { sanitizeContent } from './sanitize.js';

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx'];

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain text: blank lines separate paragraphs, single newlines become <br>. */
export function textToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Convert an uploaded file into { title, content } where content is sanitized HTML.
 * Throws HttpError(400/415) on unsupported or unreadable input.
 */
export async function importFile({ originalname, buffer }) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new HttpError(415, `Unsupported file type "${ext || 'unknown'}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  let html;
  if (ext === '.docx') {
    try {
      ({ value: html } = await mammoth.convertToHtml({ buffer }));
    } catch {
      throw new HttpError(400, 'Could not read .docx file — is it a valid Word document?');
    }
  } else {
    const text = buffer.toString('utf8');
    if (text.includes('\u0000')) throw new HttpError(400, 'File appears to be binary, not text');
    html = ext === '.txt' ? textToHtml(text) : marked.parse(text, { async: false });
  }

  const title = path.basename(originalname, ext).trim().slice(0, 200) || 'Imported document';
  return { title, content: sanitizeContent(html) };
}

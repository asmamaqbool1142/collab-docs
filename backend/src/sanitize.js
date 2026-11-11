import sanitizeHtml from 'sanitize-html';

// Only the markup the editor can actually produce is allowed through. Document
// HTML is rendered in other users' browsers once shared, so this is the XSS boundary.
const OPTIONS = {
  allowedTags: [
    'p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'], ol: ['start'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Collapse heading levels the editor doesn't offer (e.g. from .docx/.md imports).
  transformTags: { h4: 'h3', h5: 'h3', h6: 'h3' },
};

export function sanitizeContent(html) {
  return sanitizeHtml(html ?? '', OPTIONS);
}

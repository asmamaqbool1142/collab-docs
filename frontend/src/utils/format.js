/** SQLite datetime('now') is UTC without a zone marker. */
export function formatDate(sqliteTs) {
  if (!sqliteTs) return '';
  const d = new Date(sqliteTs.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

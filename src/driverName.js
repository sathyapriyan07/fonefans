export function splitDriverName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? [parts[0], parts.slice(1).join(' ')] : [parts[0] || ''];
}

export function formatDriverName(name) {
  const [givenName, surname] = splitDriverName(name);
  return [givenName, surname?.toUpperCase()].filter(Boolean).join(' ');
}

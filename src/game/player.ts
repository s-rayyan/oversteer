const KEY = 'oversteer.player';

/** Letters, digits, space and a few symbols; trimmed to 12 chars (matches firestore.rules). */
export function sanitizeName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
}

export function getName(): string {
  try {
    return sanitizeName(localStorage.getItem(KEY) ?? '');
  } catch {
    return '';
  }
}

export function setName(name: string): void {
  try {
    localStorage.setItem(KEY, sanitizeName(name));
  } catch {
    /* storage unavailable */
  }
}

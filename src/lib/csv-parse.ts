/**
 * Minimal RFC4180-ish CSV line parser (quoted fields, doubled quotes).
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsvTable(input: string): { headers: string[]; rows: string[][] } {
  const lines = input
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parsed = lines.map(parseCsvLine);
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1).filter((r) => r.some((cell) => cell.length > 0));
  return { headers, rows };
}

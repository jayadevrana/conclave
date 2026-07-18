/**
 * Best-effort extraction of a JSON object from free-form model text.
 * Strategy: prefer the LAST fenced ```json block; otherwise fall back to the
 * last balanced {...} span. The balanced scanner is STRING-AWARE — braces that
 * appear inside string values (e.g. "close the } brace") do not corrupt the
 * match. Returns null if nothing parses.
 */
export function extractJson(text) {
  if (!text || typeof text !== 'string') return null;

  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  for (let i = fences.length - 1; i >= 0; i--) {
    const parsed = tryParse(fences[i]);
    if (parsed) return parsed;
  }

  const spans = balancedObjectSpans(text);
  for (let i = spans.length - 1; i >= 0; i--) {
    const parsed = tryParse(spans[i]);
    if (parsed) return parsed;
  }
  return null;
}

function tryParse(s) {
  if (!s) return null;
  try {
    const v = JSON.parse(s.trim());
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Return every top-level balanced {...} span, ignoring braces inside string
 * literals (and handling escaped quotes). Nested objects stay part of their
 * enclosing top-level span.
 */
function balancedObjectSpans(text) {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) { spans.push(text.slice(start, i + 1)); start = -1; }
      }
    }
  }
  return spans;
}

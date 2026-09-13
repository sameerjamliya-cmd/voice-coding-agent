// Catches a real corruption pattern seen in production: a model
// double-escapes multi-line content before passing it as a tool-call
// argument, so `content` arrives containing the literal two-character
// sequence backslash+n everywhere a real line break belongs, with no
// actual newline bytes anywhere in the string. Written verbatim to disk,
// this produces a file that looks plausible in a preview but is invalid
// as the format it claims to be (e.g. `{\n  "a": 1\n}` is not valid JSON).
// A file with genuine line breaks is unaffected — this only fires when
// there isn't a single real newline in the whole string, which a
// multi-line write should always have.
const MIN_SUSPICIOUS_LITERAL_ESCAPES = 2;

export function describeLiteralEscapeCorruption(content: string): string | null {
  if (content.includes("\n")) return null;

  const literalNewlines = content.match(/\\n/g)?.length ?? 0;
  if (literalNewlines < MIN_SUSPICIOUS_LITERAL_ESCAPES) return null;

  return (
    `"content" contains ${literalNewlines} literal "\\n" sequences (a backslash followed by the letter n) ` +
    `but no real newline characters. This is a known double-escaping mistake — the text was escaped as if for ` +
    `embedding inside another JSON string, then that escaped form was used as the actual file content. ` +
    `Pass the real text with actual line breaks instead.`
  );
}

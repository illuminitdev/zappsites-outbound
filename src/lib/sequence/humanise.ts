// Strip the tells that make cold email read as machine-written. Pure and tested.

/** Phrases that read as AI or as mass-mailing. Matched case-insensitively. */
export const BANNED = [
  "i hope this email finds you well",
  "i hope this finds you well",
  "hope you're well",
  "hope you are well",
  "i hope you're having a great",
  "i came across",
  "i stumbled upon",
  "i noticed that",
  "i wanted to reach out",
  "just reaching out",
  "reaching out because",
  "i'd love to",
  "i would love to",
  "quick question",
  "game-changer",
  "game changer",
  "unlock",
  "elevate",
  "leverage",
  "seamless",
  "streamline",
  "supercharge",
  "skyrocket",
  "in today's digital",
  "in today's fast-paced",
  "digital landscape",
  "ever-evolving",
  "navigate the",
  "delve",
  "furthermore",
  "moreover",
  "additionally,",
  "it's worth noting",
  "rest assured",
  "don't hesitate",
  "feel free to",
  "at the end of the day",
  "take your business to the next level",
  "boost your online presence",
  "i'd be happy to",
  "touch base",
  "circle back",
  "no worries if not",
  "does that make sense",
  "looking forward to hearing from you",
  "best regards",
  "kind regards",
  "warm regards",
];

export function bannedFound(text: string): string[] {
  const l = text.toLowerCase().replace(/[’‘]/g, "'");
  return BANNED.filter((b) => l.includes(b));
}

/** Deterministic clean-up: punctuation and formatting habits that give the game away. */
export function humanise(text: string): string {
  return (
    text
      // Curly quotes -> straight (people type straight quotes in email).
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      // Em/en dashes used as pauses -> comma; ranges "3–5" -> "3-5".
      .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
      .replace(/\s*[—–]\s*/g, ", ")
      .replace(/,\s*,/g, ",")
      // Ellipsis character, double spaces, exclamation marks.
      .replace(/…/g, "...")
      .replace(/!+/g, ".")
      .replace(/[ \t]{2,}/g, " ")
      // Markdown that leaks into plain text.
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/^#+\s+/gm, "")
      .replace(/^\s*[•●]\s*/gm, "- ")
      // ", ." artefacts after replacements.
      .replace(/,\s*\./g, ".")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Subjects people actually send: short, mostly lowercase, no title case, no punctuation flourish. */
export function humaniseSubject(subject: string, keep: string[] = []): string {
  const keepSet = new Set(keep.flatMap((k) => k.split(/\s+/)).map((k) => k.toLowerCase()).filter(Boolean));
  const kept = (w: string) => keepSet.has(w.toLowerCase().replace(/[^a-z0-9']/g, "").replace(/'s$/, ""));
  let s = humanise(subject).replace(/[.:]+$/, "").replace(/\?+$/, "?");
  const words = s.split(/\s+/);
  // Title Case Every Word -> sentence case (keep words that are all-caps or contain a digit/brand-like capitals mid-word).
  const titleCased = words.length > 1 && words.filter((w) => /^[A-Z][a-z]/.test(w)).length >= Math.ceil(words.length * 0.6);
  if (titleCased) {
    s = words.map((w, i) => (i === 0 || kept(w) || /[A-Z]{2,}|\d|[a-z][A-Z]/.test(w) ? w : w.toLowerCase())).join(" ");
  }
  // First letter lowercase reads like a note to a colleague, unless it's "I" or an acronym/brand.
  if (/^[A-Z][a-z]/.test(s) && !/^I\b/.test(s) && !kept(s.split(/\s+/)[0])) s = s.charAt(0).toLowerCase() + s.slice(1);
  return s;
}

// Parses script text into structured slides
// Supports both "Slide 1: [text]" format and line-by-line prompt fallback.
export function parseScript(raw) {
  if (!raw || !raw.trim()) return [];

  const re = /Slide\s*(\d+)\s*[:\-.]\s*([\s\S]*?)(?=Slide\s*\d+\s*[:\-.]|$)/gi;
  const slides = [];
  let m;
  while ((m = re.exec(raw))) {
    const text = m[2].replace(/\s+/g, ' ').trim();
    if (text) slides.push({ id: Number(m[1]), text });
  }

  if (slides.length > 0) {
    return slides.sort((a, b) => a.id - b.id);
  }

  // Fallback: If no "Slide X:" format was found, parse each line as a slide
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines
    .map((line, idx) => ({
      id: idx + 1,
      text: line.replace(/^[-*•\d+.]\s*/, '').trim(),
    }))
    .filter((s) => s.text.length > 0);
}

// Pairs each slide with an image: by number in the file name (slide1.jpg),
// otherwise by file name order.
export function matchImages(slides, files) {
  if (!files || !files.length) return slides.map(() => null);

  const sorted = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  const byNumber = new Map();
  sorted.forEach((f) => {
    const m = f.name.match(/(\d+)/);
    if (m && !byNumber.has(+m[1])) byNumber.set(+m[1], f);
  });
  const useNumbers = slides.length > 0 && slides.every((s) => byNumber.has(s.id));
  return slides.map((s, k) => (useNumbers ? byNumber.get(s.id) : sorted[k] || null));
}

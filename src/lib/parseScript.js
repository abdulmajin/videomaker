// "Slide 1: The boy is running.  Slide 2: The boy is playing ball."
// -> [{ id: 1, text: 'The boy is running.' }, { id: 2, text: '...' }]
export function parseScript(raw) {
  const re = /Slide\s*(\d+)\s*[:\-.]\s*([\s\S]*?)(?=Slide\s*\d+\s*[:\-.]|$)/gi;
  const slides = [];
  let m;
  while ((m = re.exec(raw))) {
    const text = m[2].replace(/\s+/g, ' ').trim();
    if (text) slides.push({ id: Number(m[1]), text });
  }
  return slides.sort((a, b) => a.id - b.id);
}

// Pairs each slide with an image: by number in the file name (slide1.jpg),
// otherwise by file name order.
export function matchImages(slides, files) {
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

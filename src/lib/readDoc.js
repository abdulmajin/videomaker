import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Parses a CSV line accounting for quotes, commas, and escaped quotes
export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parses full storyboard CSV containing:
 * "Slide","Timecode","Sentence","Concept","Text Overlay","Prompt"
 * 
 * Returns {
 *   isStructured: boolean,
 *   scriptText: string,
 *   slidePrompts: { [idx]: string },
 *   textOverlays: { [idx]: string },
 *   timecodes: { [idx]: string },
 *   concepts: { [idx]: string }
 * }
 */
export function parseFullCsv(rawCsv) {
  const lines = rawCsv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { isStructured: false, scriptText: '', slidePrompts: {}, textOverlays: {} };
  }

  const headerLine = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/['"]/g, ''));
  
  // Find column indices
  const slideCol = headerLine.findIndex((h) => h.includes('slide'));
  const sentenceCol = headerLine.findIndex((h) => h.includes('sentence') || h.includes('text') || h.includes('script') || h.includes('voice'));
  const promptCol = headerLine.findIndex((h) => h.includes('prompt') || h.includes('image'));
  const overlayCol = headerLine.findIndex((h) => h.includes('overlay') || h.includes('hook') || h.includes('title'));
  const conceptCol = headerLine.findIndex((h) => h.includes('concept'));
  const timecodeCol = headerLine.findIndex((h) => h.includes('time') || h.includes('duration'));

  const isStructured = sentenceCol !== -1 || promptCol !== -1;
  const scriptLines = [];
  const slidePrompts = {};
  const textOverlays = {};
  const concepts = {};
  const timecodes = {};

  let slideIndex = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.length || cols.every((c) => !c)) continue;

    // Sentence / Voice text
    const sentence = sentenceCol !== -1 ? cols[sentenceCol] : cols[1] || cols[0];
    if (!sentence) continue;

    scriptLines.push(`Slide ${slideIndex + 1}: ${sentence}`);

    // Prompt
    if (promptCol !== -1 && cols[promptCol]) {
      slidePrompts[slideIndex] = cols[promptCol];
    }

    // Text Overlay / Retention Hook
    if (overlayCol !== -1 && cols[overlayCol]) {
      textOverlays[slideIndex] = cols[overlayCol].replace(/^["']|["']$/g, '').trim();
    }

    // Concept
    if (conceptCol !== -1 && cols[conceptCol]) {
      concepts[slideIndex] = cols[conceptCol];
    }

    // Timecode
    if (timecodeCol !== -1 && cols[timecodeCol]) {
      timecodes[slideIndex] = cols[timecodeCol];
    }

    slideIndex++;
  }

  return {
    isStructured,
    scriptText: scriptLines.join('\n'),
    slidePrompts,
    textOverlays,
    concepts,
    timecodes,
  };
}

// Converts standard CSV text into Slide script format
export function parseCsvToScript(rawCsv) {
  const parsed = parseFullCsv(rawCsv);
  return parsed.scriptText || rawCsv;
}

// Returns plain text or parsed structure from a document file
export async function readDoc(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.docx')) {
    const buffer = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: buffer });
    return { scriptText: res.value };
  }

  if (name.endsWith('.pdf')) {
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      text += content.items.map((it) => it.str).join(' ') + '\n';
    }
    return { scriptText: text };
  }

  if (name.endsWith('.csv')) {
    const raw = await file.text();
    const parsed = parseFullCsv(raw);
    return parsed;
  }

  const raw = await file.text();
  return { scriptText: raw };
}

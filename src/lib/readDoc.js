import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Parses simple CSV line accounting for quotes
export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
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

// Converts CSV text into standardized Slide script format
export function parseCsvToScript(rawCsv) {
  const lines = rawCsv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return '';

  const firstRow = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  let textCol = -1;
  let hasHeader = false;

  // Check if header row exists
  const textKeywords = ['script', 'text', 'content', 'sentence', 'prompt', 'caption'];
  textCol = firstRow.findIndex((col) => textKeywords.some((kw) => col.includes(kw)));

  if (textCol !== -1) {
    hasHeader = true;
  } else {
    // Default to first or second column
    textCol = firstRow.length > 1 && !isNaN(Number(firstRow[0])) ? 1 : 0;
  }

  const startLine = hasHeader ? 1 : 0;
  const slides = [];

  for (let i = startLine; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const textVal = cols[textCol] || cols[0] || '';
    if (textVal) {
      slides.push(`Slide ${slides.length + 1}: ${textVal}`);
    }
  }

  return slides.join('\n');
}

// Returns plain text from a .docx, .pdf, .csv, or .txt file.
export async function readDoc(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.docx')) {
    const buffer = await file.arrayBuffer();
    return (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
  }

  if (name.endsWith('.pdf')) {
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      text += content.items.map((it) => it.str).join(' ') + '\n';
    }
    return text;
  }

  if (name.endsWith('.csv')) {
    const raw = await file.text();
    return parseCsvToScript(raw);
  }

  return file.text();
}

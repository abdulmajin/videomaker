import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Returns plain text from a .docx, .pdf or .txt file.
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
  return file.text();
}

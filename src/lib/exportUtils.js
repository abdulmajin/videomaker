// Utilities for exporting subtitles (.srt, .vtt) and timeline data (.json)

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mimeType });
  downloadBlob(blob, filename);
}

function pad2(n) {
  return String(Math.floor(n)).padStart(2, '0');
}

function pad3(n) {
  return String(Math.floor(n)).padStart(3, '0');
}

export function toSrtTime(totalSecs) {
  const s = Math.max(0, totalSecs);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = Math.floor(s % 60);
  const millis = Math.floor((s % 1) * 1000);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
}

export function toVttTime(totalSecs) {
  const s = Math.max(0, totalSecs);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = Math.floor(s % 60);
  const millis = Math.floor((s % 1) * 1000);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

export function generateSrt(rows, slides, duration) {
  return rows
    .map((row, idx) => {
      const start = row.start;
      const end = rows[idx + 1] ? rows[idx + 1].start : duration;
      const text = slides[idx]?.text || '';
      return `${idx + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${text.trim()}\n`;
    })
    .join('\n');
}

export function generateVtt(rows, slides, duration) {
  const body = rows
    .map((row, idx) => {
      const start = row.start;
      const end = rows[idx + 1] ? rows[idx + 1].start : duration;
      const text = slides[idx]?.text || '';
      return `${idx + 1}\n${toVttTime(start)} --> ${toVttTime(end)}\n${text.trim()}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export function generateTimelineJson(
  title,
  rows,
  slides,
  duration,
  matchedImages = [],
  slideAnimations = {}
) {
  const timeline = rows.map((row, idx) => {
    const start = row.start;
    const end = rows[idx + 1] ? rows[idx + 1].start : duration;
    const slide = slides[idx] || {};
    const imgFile = matchedImages[idx];
    return {
      index: idx,
      slideId: slide.id ?? (idx + 1),
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      duration: Number((end - start).toFixed(2)),
      text: slide.text || '',
      matchScore: row.match != null ? Number(row.match.toFixed(2)) : null,
      imageFileName: imgFile?.name || null,
      animation: slideAnimations[idx] || 'auto',
    };
  });

  return JSON.stringify(
    {
      title: title || 'Untitled Video',
      totalDuration: Number(duration.toFixed(2)),
      slideCount: rows.length,
      exportedAt: new Date().toISOString(),
      timeline,
    },
    null,
    2
  );
}

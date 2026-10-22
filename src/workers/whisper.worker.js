import { pipeline } from '@huggingface/transformers';

let asr = null;
let loadedModel = null;

self.onmessage = async ({ data: { audio, model } }) => {
  try {
    if (!asr || loadedModel !== model) {
      // 'wasm' is the safest default. Try 'webgpu' for speed once everything works.
      asr = await pipeline('automatic-speech-recognition', model, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: (p) => self.postMessage({ type: 'progress', p }),
      });
      loadedModel = model;
    }
    self.postMessage({ type: 'progress', p: { status: 'transcribing' } });
    const out = await asr(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const words = out.chunks.map((c) => ({
      text: c.text,
      start: c.timestamp[0],
      end: c.timestamp[1] ?? c.timestamp[0],
    }));
    self.postMessage({ type: 'done', words });
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e?.message || e) });
  }
};

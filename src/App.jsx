import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { readDoc } from './lib/readDoc';
import { parseScript, matchImages } from './lib/parseScript';
import { decodeAudio } from './lib/audio';
import { alignSlides } from './lib/align';
import {
  downloadText,
  downloadBlob,
  generateSrt,
  generateVtt,
  generateTimelineJson,
} from './lib/exportUtils';
import {
  renderVideo,
  preloadImages,
  drawVideoFrame,
  CAPTION_STYLES,
} from './lib/renderVideo';
import { ANIMATION_TYPES, getSlideAnimation } from './lib/animations';
import {
  IMAGE_ENGINES,
  IMAGE_STYLES,
  generateSlideImage,
  enhancePrompt,
} from './lib/imageGen';
import VisualTimeline from './components/VisualTimeline';
import SlideEllipseDrawer from './components/SlideEllipseDrawer';
import ImagePreviewModal from './components/ImagePreviewModal';

const MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'Tiny, English (fast, rougher)' },
  { id: 'Xenova/whisper-base.en', label: 'Base, English (slower, better)' },
];

function transcribe(samples, model, onStatus) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/whisper.worker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        const p = data.p;
        if (p.status === 'progress') onStatus(`Downloading model… ${Math.round(p.progress)}%`);
        else if (p.status === 'transcribing') onStatus('Transcribing audio…');
      } else if (data.type === 'done') {
        worker.terminate();
        resolve(data.words);
      } else {
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.postMessage({ audio: samples, model }, [samples.buffer]);
  });
}

const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export default function App() {
  const [title, setTitle] = useState('');
  const [images, setImages] = useState([]);
  const [audio, setAudio] = useState(null);
  const [scriptText, setScriptText] = useState('');
  const [model, setModel] = useState(MODELS[0].id);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [words, setWords] = useState([]);
  const [duration, setDuration] = useState(0);
  const [rows, setRows] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Input Selection Mode: 'doc' | 'textbox' | 'images' | 'aigen'
  const [inputMode, setInputMode] = useState('doc');
  const [uploadedDocName, setUploadedDocName] = useState('');

  // AI Image Generation State
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('google_ai_key') || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [imageEngine, setImageEngine] = useState('google-imagen');
  const [visualStyle, setVisualStyle] = useState('cinematic');
  const [slidePrompts, setSlidePrompts] = useState({});
  const [generatedImages, setGeneratedImages] = useState({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 });
  const abortGenRef = useRef(false);

  // Full-Screen Image Lightbox Preview Modal
  const [previewModalIndex, setPreviewModalIndex] = useState(null);

  // Animation & Caption Customization
  const [animationMode, setAnimationMode] = useState('random');
  const [slideAnimations, setSlideAnimations] = useState({});
  const [captionStyle, setCaptionStyle] = useState('modern-card');

  // Video Export & Options
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const [videoBlobUrl, setVideoBlobUrl] = useState(null);
  const [videoFilename, setVideoFilename] = useState('');
  const [resolution, setResolution] = useState('720p');

  const audioRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const preloadedImagesRef = useRef([]);
  const abortControllerRef = useRef(null);
  const animFrameIdRef = useRef(null);

  const slides = useMemo(() => parseScript(scriptText), [scriptText]);
  const audioUrl = useMemo(() => (audio ? URL.createObjectURL(audio) : null), [audio]);
  const matched = useMemo(() => matchImages(slides, images), [slides, images]);
  const imageUrls = useMemo(
    () => matched.map((f) => (f ? URL.createObjectURL(f) : null)),
    [matched]
  );

  // Prioritize AI Generated image, then uploaded matched image
  const effectiveImageUrls = useMemo(() => {
    return slides.map((s, i) => {
      if (generatedImages[i]?.url) return generatedImages[i].url;
      if (imageUrls[i]) return imageUrls[i];
      return null;
    });
  }, [slides, generatedImages, imageUrls]);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // Preload images whenever effectiveImageUrls change
  useEffect(() => {
    let active = true;
    preloadImages(effectiveImageUrls).then((imgs) => {
      if (active) preloadedImagesRef.current = imgs;
    });
    return () => {
      active = false;
    };
  }, [effectiveImageUrls]);

  // Save API key
  const handleApiKeyChange = (val) => {
    setApiKey(val);
    localStorage.setItem('google_ai_key', val.trim());
  };

  // Render a preview frame onto the canvas
  const renderCurrentPreview = useCallback(
    (t) => {
      const canvas = previewCanvasRef.current;
      if (!canvas || !rows.length) return;
      const ctx = canvas.getContext('2d');
      drawVideoFrame({
        ctx,
        width: canvas.width,
        height: canvas.height,
        time: t,
        duration,
        rows,
        slides,
        preloadedImages: preloadedImagesRef.current,
        animationMode,
        slideAnimations,
        captionStyle,
        title,
      });
    },
    [rows, slides, duration, animationMode, slideAnimations, captionStyle, title]
  );

  // Live animation loop during playback
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      renderCurrentPreview(currentTime);
      return;
    }

    function loop() {
      if (audioRef.current) {
        const t = audioRef.current.currentTime;
        setCurrentTime(t);
        renderCurrentPreview(t);
      }
      animFrameIdRef.current = requestAnimationFrame(loop);
    }

    animFrameIdRef.current = requestAnimationFrame(loop);
    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [isPlaying, renderCurrentPreview, currentTime]);

  // Seek handler for visual timeline
  const handleSeek = (targetTime) => {
    const clamped = Math.max(0, Math.min(duration, targetTime));
    setCurrentTime(clamped);
    if (audioRef.current) {
      audioRef.current.currentTime = clamped;
    }
    renderCurrentPreview(clamped);
  };

  const setSlideAnimation = (idx, animId) => {
    setSlideAnimations((prev) => ({ ...prev, [idx]: animId }));
    setTimeout(() => renderCurrentPreview(currentTime), 20);
  };

  const setSlidePrompt = (idx, val) => {
    setSlidePrompts((prev) => ({ ...prev, [idx]: val }));
  };

  // AI Image Generation: Single Slide
  async function handleGenerateSingleImage(index) {
    const slide = slides[index];
    if (!slide) return;
    const prompt = slidePrompts[index] || slide.text;
    if (!prompt) return;

    if (imageEngine === 'google-imagen' && !apiKey.trim()) {
      setError('Please enter your Google AI Studio API key in Section 3, or select Instant Free AI.');
      return;
    }

    setError('');
    setIsGenerating(true);
    setGenStatus(`Generating AI image for Slide #${slide.id}…`);

    try {
      const res = await generateSlideImage({
        prompt,
        apiKey,
        engine: imageEngine,
        style: visualStyle,
      });

      const url = URL.createObjectURL(res.blob);
      setGeneratedImages((prev) => ({
        ...prev,
        [index]: { blob: res.blob, url, prompt, engine: res.engine },
      }));
      setGenStatus(`✨ Slide #${slide.id} image ready and attached!`);
      setTimeout(() => renderCurrentPreview(currentTime), 60);
    } catch (err) {
      setError(`Image generation error: ${err.message}`);
      setGenStatus('');
    } finally {
      setIsGenerating(false);
    }
  }

  // AI Image Generation: Batch All Slides
  async function handleGenerateAllImages() {
    if (!slides.length) {
      setError('Please add your script or prompts first.');
      return;
    }

    if (imageEngine === 'google-imagen' && !apiKey.trim()) {
      setError('Please enter your Google AI Studio API key in Section 3, or select Instant Free AI.');
      return;
    }

    setError('');
    setIsGenerating(true);
    abortGenRef.current = false;
    setGenProgress({ current: 0, total: slides.length });

    try {
      for (let i = 0; i < slides.length; i++) {
        if (abortGenRef.current) {
          setGenStatus('Generation stopped.');
          break;
        }

        const slide = slides[i];
        const prompt = slidePrompts[i] || slide.text;
        setGenProgress({ current: i + 1, total: slides.length });
        setGenStatus(
          `Generating image ${i + 1} of ${slides.length} (Slide #${slide.id}) using ${
            imageEngine === 'google-imagen' ? 'Google Imagen 3' : 'Free AI'
          }…`
        );

        const res = await generateSlideImage({
          prompt,
          apiKey,
          engine: imageEngine,
          style: visualStyle,
        });

        const url = URL.createObjectURL(res.blob);
        setGeneratedImages((prev) => ({
          ...prev,
          [i]: { blob: res.blob, url, prompt, engine: res.engine },
        }));

        setTimeout(() => renderCurrentPreview(currentTime), 30);

        // Pause briefly between requests to ensure clean rate-limit handling
        if (i < slides.length - 1) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }

      if (!abortGenRef.current) {
        setGenStatus(`🎉 Generated all ${slides.length} slide images! Synced to speech timestamps.`);
      }
    } catch (err) {
      setError(`Generation stopped: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  }

  // Auto-fill / enhance prompts for all slides
  const handleAutoFillPrompts = () => {
    const updated = {};
    slides.forEach((s, i) => {
      updated[i] = enhancePrompt(s.text, visualStyle);
    });
    setSlidePrompts(updated);
    setGenStatus('✨ Updated prompts for all slides with chosen visual style.');
  };

  // Download all generated images to local machine
  const handleDownloadAllImages = () => {
    const indices = Object.keys(generatedImages);
    if (!indices.length) return;
    indices.forEach((key, delayIndex) => {
      const item = generatedImages[key];
      if (item?.blob) {
        setTimeout(() => {
          downloadBlob(item.blob, `slide_${Number(key) + 1}.jpg`);
        }, delayIndex * 300);
      }
    });
  };

  // Download single image
  const handleDownloadSingleImage = (index) => {
    const item = generatedImages[index];
    if (item?.blob) {
      downloadBlob(item.blob, `slide_${index + 1}.jpg`);
    } else if (imageUrls[index]) {
      const a = document.createElement('a');
      a.href = imageUrls[index];
      a.download = `slide_${index + 1}.jpg`;
      a.click();
    }
  };

  async function onScriptFile(file) {
    if (!file) return;
    setError('');
    setUploadedDocName(file.name);
    try {
      const text = await readDoc(file);
      setScriptText(text);
    } catch (e) {
      setError(`Could not read the script: ${e.message}`);
    }
  }

  async function run() {
    setError('');
    setRows([]);
    setVideoBlobUrl(null);
    try {
      setStatus('Decoding audio…');
      const { samples, duration } = await decodeAudio(audio);
      setDuration(duration);
      const w = await transcribe(samples, model, setStatus);
      setWords(w);
      const aligned = alignSlides(slides, w, duration);
      setRows(aligned);
      setStatus('');
      setTimeout(() => renderCurrentPreview(0), 100);
    } catch (e) {
      setStatus('');
      setError(e.message);
    }
  }

  const realign = () => {
    const aligned = alignSlides(slides, words, duration);
    setRows(aligned);
    renderCurrentPreview(currentTime);
  };

  const setStart = (idx, v) => {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, start: Number(v) } : row)));
    renderCurrentPreview(currentTime);
  };

  const playFrom = (t) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = t;
    setCurrentTime(t);
    audioRef.current.play();
  };

  // Video Export Handler
  async function handleExportVideo() {
    if (!audio || !rows.length) return;
    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Starting video render…');
    setVideoBlobUrl(null);
    abortControllerRef.current = new AbortController();

    const [w, h] = resolution === '1080p' ? [1920, 1080] : [1280, 720];

    try {
      const { blob, filename } = await renderVideo({
        audioFile: audio,
        rows,
        slides,
        imageUrls: effectiveImageUrls,
        duration,
        title,
        width: w,
        height: h,
        fps: 30,
        animationMode,
        slideAnimations,
        captionStyle,
        onProgress: (pct, msg) => {
          setExportProgress(pct);
          setExportStatus(msg);
        },
        abortSignal: abortControllerRef.current.signal,
      });

      const url = URL.createObjectURL(blob);
      setVideoBlobUrl(url);
      setVideoFilename(filename);
      downloadBlob(blob, filename);
      setExportStatus(`Export complete! Saved as ${filename}`);
    } catch (err) {
      if (err.message !== 'Render cancelled') {
        setError(`Video export error: ${err.message}`);
      }
      setExportStatus('');
    } finally {
      setIsExporting(false);
    }
  }

  function handleCancelExport() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  // Subtitle & Timeline Exporters
  function handleExportSrt() {
    const text = generateSrt(rows, slides, duration);
    const safeTitle = (title || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadText(text, `${safeTitle}.srt`, 'text/plain;charset=utf-8');
  }

  function handleExportVtt() {
    const text = generateVtt(rows, slides, duration);
    const safeTitle = (title || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadText(text, `${safeTitle}.vtt`, 'text/vtt;charset=utf-8');
  }

  function handleExportJson() {
    const json = generateTimelineJson(title, rows, slides, duration, matched, slideAnimations);
    const safeTitle = (title || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadText(json, `${safeTitle}_timeline.json`, 'application/json;charset=utf-8');
  }

  const ready = audio && slides.length > 0 && !status;

  // Active slide index in timeline playback
  let activeSlideIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    if (currentTime >= rows[i].start) {
      activeSlideIndex = i;
    } else {
      break;
    }
  }

  const pendingVisualsCount = Math.max(
    0,
    slides.length - effectiveImageUrls.filter(Boolean).length
  );
  const visualReadinessPct =
    slides.length > 0
      ? Math.min(100, Math.round((effectiveImageUrls.filter(Boolean).length / slides.length) * 100))
      : 0;

  return (
    <main>
      <header>
        <div className="header-badge">Video Maker Studio v1.0</div>
        <h1>AI Slide Video Maker</h1>
        <p>
          Select your input method, upload files or type line-by-line prompts, generate visuals with
          Google Flow / Imagen 3, preview in high-res, and export your finished video.
        </p>
      </header>

      {/* 1. Global Project Title & Voice Recording Section */}
      <section>
        <h2>1. Project Audio &amp; Title</h2>
        <div className="grid-2">
          <label>
            Video title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. My Educational Video"
            />
          </label>
          <label>
            Voice recording (audio file)
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setAudio(e.target.files[0] || null)}
            />
          </label>
        </div>

        {audioUrl && (
          <div className="audio-player-box">
            <label className="audio-label">Voiceover Audio Player</label>
            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setCurrentTime(t);
                if (!isPlaying) renderCurrentPreview(t);
              }}
            />
          </div>
        )}
      </section>

      {/* 2. Input Method Selector Tabs (Doc Upload, Text Box, Images, AI Prompts) */}
      <section className="input-method-section">
        <div className="section-header-row">
          <div>
            <h2>2. Script &amp; Image Input Selection</h2>
            <p className="hint">Choose how you want to provide your script, prompts, or visuals:</p>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="input-mode-tabs">
          <button
            type="button"
            className={`input-mode-tab ${inputMode === 'doc' ? 'active' : ''}`}
            onClick={() => setInputMode('doc')}
          >
            📁 Document File (.pdf, .docx, .txt, .csv)
          </button>
          <button
            type="button"
            className={`input-mode-tab ${inputMode === 'textbox' ? 'active' : ''}`}
            onClick={() => setInputMode('textbox')}
          >
            ✍️ Direct Text Box (Type / Paste)
          </button>
          <button
            type="button"
            className={`input-mode-tab ${inputMode === 'images' ? 'active' : ''}`}
            onClick={() => setInputMode('images')}
          >
            🖼️ Upload Images ({images.length})
          </button>
          <button
            type="button"
            className={`input-mode-tab ${inputMode === 'aigen' ? 'active' : ''}`}
            onClick={() => setInputMode('aigen')}
          >
            ✨ AI Prompt Studio (Google Flow)
          </button>
        </div>

        {/* Tab 1: Document Upload (.pdf, .docx, .txt, .csv) */}
        {inputMode === 'doc' && (
          <div className="tab-pane">
            <div className="file-drop-card">
              <label className="file-upload-label">
                <span className="file-upload-icon">📄</span>
                <strong>Choose a Script File (.pdf, .docx, .txt, or .csv)</strong>
                <span className="file-upload-hint">
                  Supports PDF documents, Word .docx, plain text, and structured CSV spreadsheets.
                </span>
                <input
                  type="file"
                  accept=".docx,.pdf,.txt,.csv"
                  onChange={(e) => onScriptFile(e.target.files[0])}
                  className="hidden-file-input"
                />
                <span className="browse-files-btn">Browse Files</span>
              </label>
              {uploadedDocName && (
                <div className="uploaded-file-tag">
                  <span>✓ Loaded: <strong>{uploadedDocName}</strong></span>
                  <small>({slides.length} slides detected)</small>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Direct Text Box */}
        {inputMode === 'textbox' && (
          <div className="tab-pane">
            <p className="hint">
              Type or paste your text line by line or as &quot;Slide 1: [content]&quot;. Slides update automatically.
            </p>
            <textarea
              rows={7}
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder={
                'Slide 1: Welcome to our lesson today.\nSlide 2: In this part, we explore the solar system.\nSlide 3: Here is a futuristic spacecraft approaching Mars.'
              }
            />
          </div>
        )}

        {/* Tab 3: Local Images Upload */}
        {inputMode === 'images' && (
          <div className="tab-pane">
            <label>
              Select Image Files from your computer:
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setImages([...e.target.files])}
              />
              <small>
                {images.length} images selected. Name them slide1.jpg, slide2.jpg to auto-order, or they match in sequence.
              </small>
            </label>

            {images.length > 0 && (
              <div className="uploaded-thumbs-gallery">
                {imageUrls.map((url, idx) => (
                  <div
                    key={idx}
                    className="uploaded-thumb-chip"
                    onClick={() => setPreviewModalIndex(idx)}
                    title="Click to view preview"
                  >
                    {url && <img src={url} alt={`Uploaded ${idx + 1}`} />}
                    <span>#{idx + 1}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: AI Prompt Studio Quick View */}
        {inputMode === 'aigen' && (
          <div className="tab-pane">
            <p className="hint">
              Generate 16:9 widescreen images directly from prompts line-by-line using Google Imagen 3 (Google Flow Engine). See Section 3 below to run generation!
            </p>
          </div>
        )}

        {/* Image Prompt Count Metrics Card */}
        <div className="prompt-metrics-card">
          <div className="metrics-col">
            <span className="metrics-num">{slides.length}</span>
            <span className="metrics-label">Image Prompts / Slides</span>
          </div>
          <div className="metrics-col">
            <span className="metrics-num text-success">
              {Object.keys(generatedImages).length}
            </span>
            <span className="metrics-label">AI Generated</span>
          </div>
          <div className="metrics-col">
            <span className="metrics-num text-info">{images.length}</span>
            <span className="metrics-label">Uploaded Files</span>
          </div>
          <div className="metrics-col">
            <span className="metrics-num text-warn">{pendingVisualsCount}</span>
            <span className="metrics-label">Pending Visuals</span>
          </div>
          <div className="metrics-progress-col">
            <div className="metrics-bar-label">
              <span>Visual Readiness</span>
              <span>{visualReadinessPct}%</span>
            </div>
            <div className="progress-bar-bg small">
              <div
                className="progress-bar-fill"
                style={{ width: `${visualReadinessPct}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 3. AI Image Generation Studio (Google Flow / Imagen 3) */}
      <section className="image-gen-section">
        <div className="section-header-row">
          <div>
            <h2>3. AI Image Generation Studio (Google Flow / Imagen 3)</h2>
            <p className="hint">
              Generate 16:9 widescreen images directly from your script prompts line-by-line without uploading files.
            </p>
          </div>
          <span className="badge badge-info">Google Imagen 3 Ready</span>
        </div>

        <div className="image-gen-grid">
          {/* Engine Selector */}
          <label>
            Image Generation Engine:
            <select
              value={imageEngine}
              onChange={(e) => setImageEngine(e.target.value)}
              disabled={isGenerating}
            >
              {IMAGE_ENGINES.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.label}
                </option>
              ))}
            </select>
          </label>

          {/* Visual Style Preset */}
          <label>
            Visual Art Style:
            <select
              value={visualStyle}
              onChange={(e) => setVisualStyle(e.target.value)}
              disabled={isGenerating}
            >
              {IMAGE_STYLES.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* API Key Input for Google Imagen 3 */}
        {imageEngine === 'google-imagen' && (
          <div className="api-key-box">
            <label>
              Google AI Studio API Key:
              <div className="api-key-input-row">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder="AIzaSy..."
                  className="api-key-input"
                />
                <button
                  type="button"
                  className="ghost small-btn"
                  onClick={() => setShowApiKey((v) => !v)}
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <small>
                Get your free API key at{' '}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="link-highlight"
                >
                  aistudio.google.com
                </a>{' '}
                (stored securely in your browser's localStorage).
              </small>
            </label>
          </div>
        )}

        {/* Action Buttons Bar */}
        <div className="gen-actions-bar">
          <button
            type="button"
            className="primary-btn"
            disabled={isGenerating || slides.length === 0}
            onClick={handleGenerateAllImages}
          >
            {isGenerating ? '⏳ Generating in progress…' : '🚀 Generate Images for ALL Slides'}
          </button>

          <button
            type="button"
            className="ghost"
            disabled={isGenerating || slides.length === 0}
            onClick={handleAutoFillPrompts}
            title="Automatically format prompts from script with chosen style"
          >
            ✨ Enhance Prompts from Script
          </button>

          {Object.keys(generatedImages).length > 0 && (
            <button
              type="button"
              className="ghost"
              onClick={handleDownloadAllImages}
              title="Download all generated image files"
            >
              💾 Download All Generated Images ({Object.keys(generatedImages).length})
            </button>
          )}

          {isGenerating && (
            <button
              type="button"
              className="danger-btn"
              onClick={() => {
                abortGenRef.current = true;
                setIsGenerating(false);
              }}
            >
              Stop Generation
            </button>
          )}
        </div>

        {/* Enhanced Step-by-Step Loading Progress Bar */}
        {isGenerating && (
          <div className="gen-progress-card enhanced-progress">
            <div className="gen-progress-header">
              <span className="pulsing-ai-icon">⚡</span>
              <div className="gen-progress-text">
                <strong>Generating Slide Images with AI…</strong>
                <p className="gen-progress-sub">{genStatus}</p>
              </div>
              <span className="gen-pct">
                {genProgress.total > 0
                  ? Math.round((genProgress.current / genProgress.total) * 100)
                  : 0}
                %
              </span>
            </div>

            <div className="progress-bar-bg glowing">
              <div
                className="progress-bar-fill animated-shimmer"
                style={{
                  width: `${
                    genProgress.total > 0
                      ? Math.round((genProgress.current / genProgress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>

            {/* Slide Step Chips */}
            <div className="gen-steps-track">
              {slides.map((s, idx) => {
                const isDone = Boolean(generatedImages[idx]);
                const isCurrent = isGenerating && genProgress.current === idx + 1;
                return (
                  <span
                    key={s.id || idx}
                    className={`step-chip ${
                      isDone ? 'done' : isCurrent ? 'current' : 'pending'
                    }`}
                    onClick={() => setPreviewModalIndex(idx)}
                    title={`Slide #${s.id}: ${
                      isDone ? 'Generated (Click to preview)' : isCurrent ? 'Generating…' : 'Pending'
                    }`}
                  >
                    {isDone ? '✓' : isCurrent ? '⚡' : '○'} Slide {s.id}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {genStatus && !isGenerating && <p className="status-success">{genStatus}</p>}
      </section>

      {/* 4. Speech-to-Text & Timestamp Alignment */}
      <section>
        <h2>4. Speech-to-Text &amp; Alignment</h2>
        <div className="row">
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button onClick={run} disabled={!ready}>
            Transcribe &amp; Align Slides
          </button>
          {words.length > 0 && (
            <button className="ghost" onClick={realign}>
              Re-align
            </button>
          )}
        </div>
        {status && <p className="status">{status}</p>}
        {error && <p className="error">{error}</p>}
        {!audio && <p className="hint">Upload a voice recording above to enable transcription.</p>}
      </section>

      {/* 5. Synchronized Live Video Preview & Controls */}
      {rows.length > 0 && (
        <section className="preview-section">
          <div className="preview-header-bar">
            <h2>5. Live Synced Video Preview</h2>
            <span className="badge badge-info">Clean Video Mode</span>
          </div>
          <p className="hint">
            Slide images, animations, and voiceover are synchronized in real time. Use the video timeline below to scrub through your video. Click any thumbnail for full-size image preview!
          </p>

          {/* Clean Canvas Rendering Frame */}
          <div className="video-player-frame">
            <canvas
              ref={previewCanvasRef}
              width={1280}
              height={720}
              className="preview-canvas"
            />
          </div>

          {/* Professional Video Player Timeline (Scrollable & Zoomable) */}
          <VisualTimeline
            rows={rows}
            slides={slides}
            duration={duration}
            currentTime={currentTime}
            isPlaying={isPlaying}
            imageUrls={effectiveImageUrls}
            animationMode={animationMode}
            slideAnimations={slideAnimations}
            onSeek={handleSeek}
            onTogglePlay={() => {
              if (audioRef.current) {
                if (audioRef.current.paused) audioRef.current.play();
                else audioRef.current.pause();
              }
            }}
          />

          {/* Collapsible Ellipse List of Slide Images, Prompts & Animations */}
          <SlideEllipseDrawer
            rows={rows}
            slides={slides}
            duration={duration}
            currentTime={currentTime}
            effectiveImageUrls={effectiveImageUrls}
            generatedImages={generatedImages}
            animationMode={animationMode}
            slideAnimations={slideAnimations}
            slidePrompts={slidePrompts}
            onSetSlideAnimation={setSlideAnimation}
            onSetSlidePrompt={setSlidePrompt}
            onGenerateSlideImage={handleGenerateSingleImage}
            onPreviewImage={(idx) => setPreviewModalIndex(idx)}
            onSeek={handleSeek}
            isGenerating={isGenerating}
          />

          {/* Global Animation & Caption Style Settings */}
          <div className="customization-panel">
            <h3>🎨 Global Animation &amp; Caption Style Settings</h3>
            <div className="customization-grid">
              <label>
                Default Animation Style:
                <select
                  value={animationMode}
                  onChange={(e) => {
                    setAnimationMode(e.target.value);
                    setTimeout(() => renderCurrentPreview(currentTime), 20);
                  }}
                >
                  {ANIMATION_TYPES.map((anim) => (
                    <option key={anim.id} value={anim.id}>
                      {anim.label}
                    </option>
                  ))}
                </select>
                <small>Used for slides set to Auto / Random.</small>
              </label>

              <label>
                Caption &amp; Subtitle Style:
                <select
                  value={captionStyle}
                  onChange={(e) => {
                    setCaptionStyle(e.target.value);
                    setTimeout(() => renderCurrentPreview(currentTime), 20);
                  }}
                >
                  {CAPTION_STYLES.map((cs) => (
                    <option key={cs.id} value={cs.id}>
                      {cs.label}
                    </option>
                  ))}
                </select>
                <small>Choose between Social Pop, Modern Card, Cinema, or None.</small>
              </label>
            </div>
          </div>
        </section>
      )}

      {/* 6. Timeline Editor & Prompt Adjustments Table */}
      {rows.length > 0 && (
        <section>
          <h2>6. Slide Timeline, Prompts &amp; Animation Styles</h2>
          <p className="hint">
            Customize image prompts, generate/re-roll images, or click on any thumbnail for full-size image preview.
          </p>
          <table>
            <thead>
              <tr>
                <th>Slide</th>
                <th>Image Preview</th>
                <th>AI Prompt</th>
                <th>Animation Style</th>
                <th>Start (s)</th>
                <th>End</th>
                <th>Match</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const end = rows[i + 1] ? rows[i + 1].start : duration;
                const isActive = activeSlideIndex === i;
                const assignedAutoAnim = getSlideAnimation(animationMode, i);
                const currentSlideAnim = slideAnimations[i] || 'auto';
                const currentPrompt = slidePrompts[i] ?? slides[i]?.text ?? '';
                const imgUrl = effectiveImageUrls[i];
                const isAi = Boolean(generatedImages[i]);

                return (
                  <tr
                    key={row.id}
                    className={`${row.match < 0.5 ? 'weak' : ''} ${isActive ? 'active-row' : ''}`}
                  >
                    <td>
                      <strong>#{row.id}</strong>
                    </td>
                    <td>
                      <div
                        className="table-img-cell"
                        onClick={() => setPreviewModalIndex(i)}
                        title="Click for full-size image preview"
                      >
                        {imgUrl ? (
                          <img
                            src={imgUrl}
                            alt={`Slide ${row.id}`}
                            className="table-thumb clickable"
                          />
                        ) : (
                          <span className="muted-text">none</span>
                        )}
                        {isAi && <span className="ai-tiny-tag">AI</span>}
                      </div>
                    </td>
                    <td className="text">
                      <input
                        type="text"
                        className="table-prompt-input"
                        value={currentPrompt}
                        onChange={(e) => setSlidePrompt(i, e.target.value)}
                        placeholder="Image prompt for this slide..."
                      />
                    </td>
                    <td>
                      <select
                        className="table-anim-select"
                        value={currentSlideAnim}
                        onChange={(e) => setSlideAnimation(i, e.target.value)}
                        title="Change animation for this slide"
                      >
                        <option value="auto">🎲 Auto ({assignedAutoAnim})</option>
                        <option value="zoom-in">🔍 Zoom In</option>
                        <option value="zoom-out">🔎 Zoom Out</option>
                        <option value="pop">✨ Pop &amp; Bounce</option>
                        <option value="breathe">🫁 Breathe</option>
                        <option value="slide-left">⬅️ Slide Left</option>
                        <option value="slide-right">➡️ Slide Right</option>
                        <option value="slide-up">⬆️ Slide Up</option>
                        <option value="fade">🌫️ Fade</option>
                        <option value="pan-drift">🌊 Pan &amp; Drift</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={row.start}
                        onChange={(e) => setStart(i, e.target.value)}
                      />
                    </td>
                    <td>{fmt(end)}</td>
                    <td>
                      <span
                        className={`match-pill ${row.match >= 0.7 ? 'match-high' : row.match >= 0.4 ? 'match-mid' : 'match-low'}`}
                      >
                        {Math.round(row.match * 100)}%
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="ghost small-btn"
                          disabled={isGenerating}
                          onClick={() => handleGenerateSingleImage(i)}
                          title="Generate or re-roll image for this slide"
                        >
                          {isAi ? '🔄 Re-roll' : '🎨 Generate'}
                        </button>
                        <button
                          type="button"
                          className="ghost small-btn"
                          onClick={() => setPreviewModalIndex(i)}
                          title="Preview full-size image"
                        >
                          👁️ View
                        </button>
                        <button
                          type="button"
                          className="ghost small-btn"
                          onClick={() => playFrom(row.start)}
                        >
                          Play
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* 7. Export Section */}
      {rows.length > 0 && (
        <section className="export-section">
          <h2>7. Export Finished Video &amp; Subtitles</h2>

          <div className="export-grid">
            {/* Video Export Card */}
            <div className="export-card">
              <h3>🎬 Render &amp; Export Video</h3>
              <p className="hint">
                Generates a clean video with AI-generated images, animations, voiceover, and captions.
              </p>

              <div className="export-options">
                <label className="inline-label">
                  Resolution:
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    disabled={isExporting}
                  >
                    <option value="720p">720p HD (1280x720) - Fast</option>
                    <option value="1080p">1080p Full HD (1920x1080) - Sharp</option>
                  </select>
                </label>

                <div className="export-summary-pills">
                  <span className="badge badge-info">
                    {Object.values(slideAnimations).filter((v) => v !== 'auto').length > 0
                      ? `${Object.values(slideAnimations).filter((v) => v !== 'auto').length} custom animations`
                      : `Global Mode: ${animationMode}`}
                  </span>
                  <span className="badge">Captions: {captionStyle}</span>
                  <span className="badge badge-success">
                    {Object.keys(generatedImages).length} AI images applied
                  </span>
                </div>
              </div>

              {isExporting ? (
                <div className="export-progress-box">
                  <div className="progress-bar-bg">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${exportProgress}%` }}
                    />
                  </div>
                  <p className="status">{exportStatus}</p>
                  <button className="danger-btn" onClick={handleCancelExport}>
                    Cancel Render
                  </button>
                </div>
              ) : (
                <div className="row">
                  <button onClick={handleExportVideo} className="primary-btn">
                    Render &amp; Download Video
                  </button>
                </div>
              )}

              {videoBlobUrl && !isExporting && (
                <div className="rendered-result">
                  <p className="success-text">🎉 Video rendered successfully!</p>
                  <video src={videoBlobUrl} controls className="rendered-video-preview" />
                  <div className="row">
                    <button
                      className="ghost"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = videoBlobUrl;
                        a.download = videoFilename;
                        a.click();
                      }}
                    >
                      Download Again ({videoFilename})
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Subtitles & Data Export Card */}
            <div className="export-card">
              <h3>📝 Subtitles &amp; Timeline Data</h3>
              <p className="hint">
                Export standard subtitle files (.srt, .vtt) or complete JSON timing data for use in CapCut, Premiere, or YouTube.
              </p>

              <div className="export-buttons-stack">
                <button className="ghost export-btn" onClick={handleExportSrt}>
                  <span>Download <strong>.SRT</strong> Subtitles</span>
                  <small>Compatible with Premiere, YouTube, VLC</small>
                </button>

                <button className="ghost export-btn" onClick={handleExportVtt}>
                  <span>Download <strong>.VTT</strong> Subtitles</span>
                  <small>Web standard format for HTML5 video</small>
                </button>

                <button className="ghost export-btn" onClick={handleExportJson}>
                  <span>Download <strong>.JSON</strong> Timeline</span>
                  <small>Full metadata with slide IDs, prompts, and timestamps</small>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Interactive Full-Size Image Preview Lightbox Modal */}
      <ImagePreviewModal
        isOpen={previewModalIndex !== null}
        slideIndex={previewModalIndex ?? 0}
        slides={slides}
        rows={rows}
        duration={duration}
        effectiveImageUrls={effectiveImageUrls}
        generatedImages={generatedImages}
        slidePrompts={slidePrompts}
        slideAnimations={slideAnimations}
        onClose={() => setPreviewModalIndex(null)}
        onSelectSlide={(idx) => setPreviewModalIndex(idx)}
        onGenerateImage={handleGenerateSingleImage}
        onDownloadImage={handleDownloadSingleImage}
      />
    </main>
  );
}

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
import VisualTimeline from './components/VisualTimeline';
import SlideEllipseDrawer from './components/SlideEllipseDrawer';

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

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // Preload images whenever imageUrls change
  useEffect(() => {
    let active = true;
    preloadImages(imageUrls).then((imgs) => {
      if (active) preloadedImagesRef.current = imgs;
    });
    return () => {
      active = false;
    };
  }, [imageUrls]);

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

  async function onScriptFile(file) {
    if (!file) return;
    setError('');
    try {
      setScriptText(await readDoc(file));
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
        imageUrls,
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

  // Find active slide index
  let activeSlideIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    if (currentTime >= rows[i].start) {
      activeSlideIndex = i;
    } else {
      break;
    }
  }

  return (
    <main>
      <header>
        <div className="header-badge">Video Maker Studio v1.0</div>
        <h1>AI Slide Video Maker</h1>
        <p>
          Add images, a voiceover, and your script. Align audio with speech recognition, customize
          Canva-style animations per slide, and export your video and subtitles.
        </p>
      </header>

      {/* Input Section */}
      <section>
        <h2>1. Project Inputs</h2>
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
            Script (.docx, .pdf or .txt)
            <input
              type="file"
              accept=".docx,.pdf,.txt"
              onChange={(e) => onScriptFile(e.target.files[0])}
            />
          </label>
        </div>

        <div className="grid-2">
          <label>
            Images (select multiple)
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setImages([...e.target.files])}
            />
            <small>{images.length} images selected. (Name slide1.jpg, slide2.jpg to auto-order)</small>
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

      {/* Script Section */}
      <section>
        <h2>2. Script Content</h2>
        <p className="hint">
          Format slides as &quot;Slide 1: [content]&quot;. Edit here anytime; slides update dynamically.
        </p>
        <textarea
          rows={6}
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder={'Slide 1: Welcome to our lesson today.\nSlide 2: In this part, we explore the solar system.'}
        />
        <div className="script-stats">
          <span className="badge">
            {slides.length ? `${slides.length} slides detected` : 'No slides detected'}
          </span>
          {images.length > 0 && (
            <span className="badge badge-info">
              {matched.filter(Boolean).length} / {slides.length} slides matched with images
            </span>
          )}
        </div>
      </section>

      {/* Alignment Section */}
      <section>
        <h2>3. Speech-to-Text &amp; Alignment</h2>
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

      {/* Synchronized Live Video Preview & Controls */}
      {rows.length > 0 && (
        <section className="preview-section">
          <div className="preview-header-bar">
            <h2>4. Live Synced Video Preview</h2>
            <span className="badge badge-info">Clean Video Mode</span>
          </div>
          <p className="hint">
            Watch slide animations synchronize with the voiceover in real time. Use the interactive timeline below to scrub through your video.
          </p>

          {/* Clean Canvas Rendering Frame (No progress bar inside video) */}
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
            imageUrls={imageUrls}
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

          {/* Collapsible Ellipse List of Slide Images & Animations */}
          <SlideEllipseDrawer
            rows={rows}
            slides={slides}
            duration={duration}
            currentTime={currentTime}
            imageUrls={imageUrls}
            animationMode={animationMode}
            slideAnimations={slideAnimations}
            onSetSlideAnimation={setSlideAnimation}
            onSeek={handleSeek}
          />

          {/* Global Animation & Caption Style Settings */}
          <div className="customization-panel">
            <h3>🎨 Global Animation &amp; Caption Style Settings</h3>
            <div className="customization-grid">
              <label>
                Default / Fallback Animation:
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

      {/* Timeline Editor with Per-Slide Animation Selectors */}
      {rows.length > 0 && (
        <section>
          <h2>5. Slide Timeline &amp; Animation Styles</h2>
          <p className="hint">
            Customize the animation style for each individual slide below, or adjust start timings.
          </p>
          <table>
            <thead>
              <tr>
                <th>Slide</th>
                <th>Image</th>
                <th>Animation Style</th>
                <th>Script Text</th>
                <th>Start (s)</th>
                <th>End</th>
                <th>Match</th>
                <th>Preview</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const end = rows[i + 1] ? rows[i + 1].start : duration;
                const isActive = activeSlideIndex === i;
                const assignedAutoAnim = getSlideAnimation(animationMode, i);
                const currentSlideAnim = slideAnimations[i] || 'auto';

                return (
                  <tr
                    key={row.id}
                    className={`${row.match < 0.5 ? 'weak' : ''} ${isActive ? 'active-row' : ''}`}
                  >
                    <td>
                      <strong>#{row.id}</strong>
                    </td>
                    <td>
                      {imageUrls[i] ? (
                        <img
                          src={imageUrls[i]}
                          alt={`Slide ${row.id}`}
                          className="table-thumb"
                        />
                      ) : (
                        <span className="muted-text">none</span>
                      )}
                    </td>
                    <td>
                      {/* Interactive Animation Selector for this Slide */}
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
                    <td className="text">{slides[i]?.text}</td>
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
                      <button className="ghost small-btn" onClick={() => playFrom(row.start)}>
                        Play
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Export Section */}
      {rows.length > 0 && (
        <section className="export-section">
          <h2>6. Export Finished Video &amp; Subtitles</h2>

          <div className="export-grid">
            {/* Option 2: Video Export Card */}
            <div className="export-card">
              <h3>🎬 Render &amp; Export Video</h3>
              <p className="hint">
                Generates a clean video with your selected per-slide animations, voiceover, and captions.
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
                      ? `${Object.values(slideAnimations).filter((v) => v !== 'auto').length} customized animations`
                      : `Global Mode: ${animationMode}`}
                  </span>
                  <span className="badge">Captions: {captionStyle}</span>
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

            {/* Option 3: Subtitles & Data Export Card */}
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
                  <small>Full metadata with slide IDs, animations, and timestamps</small>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

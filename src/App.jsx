import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { decodeAudio, mergeAudioFiles } from './lib/audio';
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
import { ANIMATION_TYPES } from './lib/animations';
import {
  IMAGE_ENGINES,
  IMAGE_STYLES,
  verifyGoogleApiKey,
} from './lib/imageGen';
import SectionEditor from './components/SectionEditor';
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

const fmt = (s) => {
  if (isNaN(s) || s < 0) s = 0;
  const mins = Math.floor(s / 60);
  const secs = (s % 60).toFixed(1);
  return `${String(mins).padStart(2, '0')}:${secs.padStart(4, '0')}`;
};

function createNewSection(index) {
  return {
    id: `sec-${Date.now()}-${index}`,
    title: `Section ${index}`,
    audio: null,
    audioUrl: null,
    duration: 0,
    scriptText: '',
    uploadedDocName: '',
    inputMode: 'doc',
    images: [],
    slidePrompts: {},
    generatedImages: {},
    manualImages: {},
    slideAnimations: {},
    rows: [],
    slides: [],
    effectiveImageUrls: [],
    isCollapsed: false,
  };
}

export default function App() {
  const [projectTitle, setProjectTitle] = useState('My Video Project');
  const [model, setModel] = useState(MODELS[0].id);

  // Global AI Engine & API Key
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('google_ai_key') || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [imageEngine, setImageEngine] = useState('google-imagen');
  const [visualStyle, setVisualStyle] = useState('cinematic');

  // Animation & Subtitle Styling
  const [animationMode, setAnimationMode] = useState('random');
  const [captionStyle, setCaptionStyle] = useState('modern-card');

  // Multi-Section Video Architecture State
  const [sections, setSections] = useState(() => [createNewSection(1)]);
  const [mergedData, setMergedData] = useState(null);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [mergedPlaying, setMergedPlaying] = useState(false);
  const [mergedCurrentTime, setMergedCurrentTime] = useState(0);

  // Video Export
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const [resolution, setResolution] = useState('720p');

  // Lightbox Modal
  const [previewModalData, setPreviewModalData] = useState(null); // { url, title }

  const mergedAudioRef = useRef(null);
  const mergedCanvasRef = useRef(null);
  const mergedAnimFrameRef = useRef(null);
  const preloadedMergedImagesRef = useRef([]);
  const abortControllerRef = useRef(null);

  // Save API key
  const handleApiKeyChange = (val) => {
    setApiKey(val);
    localStorage.setItem('google_ai_key', val.trim());
    setApiKeyStatus(null);
  };

  const handleVerifyApiKey = async () => {
    if (!apiKey.trim()) {
      setApiKeyStatus({ valid: false, message: 'Please enter an API key first.' });
      return;
    }
    setIsVerifying(true);
    setApiKeyStatus(null);
    try {
      const result = await verifyGoogleApiKey(apiKey);
      setApiKeyStatus(result);
    } catch (e) {
      setApiKeyStatus({ valid: false, message: `Verification error: ${e.message}` });
    } finally {
      setIsVerifying(false);
    }
  };

  // Sections Provision: Adjust number of sections
  const setSectionCount = (targetCount) => {
    const count = Math.max(1, targetCount);
    setSections((prev) => {
      if (prev.length === count) return prev;
      if (prev.length < count) {
        const next = [...prev];
        for (let i = prev.length + 1; i <= count; i++) {
          next.push(createNewSection(i));
        }
        return next;
      } else {
        return prev.slice(0, count);
      }
    });
  };

  const handleAddSection = () => {
    setSections((prev) => [...prev, createNewSection(prev.length + 1)]);
  };

  const handleRemoveSection = (idx) => {
    if (sections.length <= 1) return;
    setSections((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateSection = (idx, updater) => {
    setSections((prev) => {
      const next = [...prev];
      const current = next[idx];
      next[idx] = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      return next;
    });
  };

  // Preload merged images when mergedData changes
  useEffect(() => {
    if (!mergedData?.effectiveImageUrls) return;
    let active = true;
    preloadImages(mergedData.effectiveImageUrls).then((imgs) => {
      if (active) preloadedMergedImagesRef.current = imgs;
    });
    return () => {
      active = false;
    };
  }, [mergedData?.effectiveImageUrls]);

  // Master Merged Canvas Frame Renderer
  const renderMergedPreview = useCallback(
    (t) => {
      const canvas = mergedCanvasRef.current;
      if (!canvas || !mergedData?.rows?.length) return;
      const ctx = canvas.getContext('2d');
      drawVideoFrame({
        ctx,
        width: canvas.width,
        height: canvas.height,
        time: t,
        duration: mergedData.duration || 1,
        rows: mergedData.rows,
        slides: mergedData.slides,
        preloadedImages: preloadedMergedImagesRef.current,
        animationMode,
        slideAnimations: mergedData.slideAnimations || {},
        captionStyle,
        title: '', // Rule: Title should NOT appear on video
      });
    },
    [mergedData, animationMode, captionStyle]
  );

  // Playback loop for master merged video
  useEffect(() => {
    if (!mergedPlaying) {
      if (mergedAnimFrameRef.current) cancelAnimationFrame(mergedAnimFrameRef.current);
      renderMergedPreview(mergedCurrentTime);
      return;
    }

    function loop() {
      if (mergedAudioRef.current) {
        const t = mergedAudioRef.current.currentTime;
        setMergedCurrentTime(t);
        renderMergedPreview(t);
      }
      mergedAnimFrameRef.current = requestAnimationFrame(loop);
    }

    mergedAnimFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (mergedAnimFrameRef.current) cancelAnimationFrame(mergedAnimFrameRef.current);
    };
  }, [mergedPlaying, renderMergedPreview, mergedCurrentTime]);

  const handleMergedSeek = (t) => {
    const clamped = Math.max(0, Math.min(mergedData?.duration || 1, t));
    setMergedCurrentTime(clamped);
    if (mergedAudioRef.current) mergedAudioRef.current.currentTime = clamped;
    renderMergedPreview(clamped);
  };

  // Merge All Sections into Final Video
  const handleMergeAllSections = async () => {
    const readySections = sections.filter((s) => s.audio && s.rows?.length > 0);
    if (readySections.length === 0) {
      setMergeError(
        'Please ensure at least one section has voice audio and aligned slides before merging.'
      );
      return;
    }

    setMergeError('');
    setIsMerging(true);

    try {
      // 1. Merge audio files sequentially into one seamless WAV Blob
      const audioFiles = readySections.map((s) => s.audio);
      const mergedAudioResult = await mergeAudioFiles(audioFiles);
      if (!mergedAudioResult) {
        throw new Error('Failed to merge audio files.');
      }

      const mergedAudioUrl = URL.createObjectURL(mergedAudioResult.blob);

      // 2. Stitch rows, slides, and images with cumulative time offsets
      const mergedRows = [];
      const mergedSlides = [];
      const mergedImageUrls = [];
      const mergedSlideAnimations = {};
      let globalSlideId = 1;
      let timeOffset = 0;

      readySections.forEach((sec, secIdx) => {
        const secRows = sec.rows || [];
        const secSlides = sec.slides || [];
        const secImages = sec.effectiveImageUrls || [];

        secRows.forEach((row, rowIdx) => {
          const slide = secSlides[rowIdx] || {};
          const imgUrl = secImages[rowIdx] || null;
          const anim = sec.slideAnimations?.[rowIdx] || 'auto';

          mergedRows.push({
            id: globalSlideId,
            start: row.start + timeOffset,
            text: row.text || slide.text || '',
            sectionIndex: secIdx,
            sectionTitle: sec.title || `Section ${secIdx + 1}`,
          });

          mergedSlides.push({
            id: globalSlideId,
            text: slide.text || row.text || '',
            raw: slide.raw || '',
            sectionIndex: secIdx,
          });

          mergedImageUrls.push(imgUrl);
          mergedSlideAnimations[globalSlideId - 1] = anim;
          globalSlideId++;
        });

        timeOffset += sec.duration;
      });

      setMergedData({
        audioFile: mergedAudioResult.blob,
        audioUrl: mergedAudioUrl,
        duration: mergedAudioResult.duration,
        rows: mergedRows,
        slides: mergedSlides,
        effectiveImageUrls: mergedImageUrls,
        slideAnimations: mergedSlideAnimations,
      });

      setTimeout(() => renderMergedPreview(0), 100);
    } catch (err) {
      setMergeError(`Merge failed: ${err.message}`);
    } finally {
      setIsMerging(false);
    }
  };

  // Video Export for Merged Video
  const handleExportMergedVideo = async () => {
    if (!mergedData?.audioFile || !mergedData?.rows?.length) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Starting video render…');
    abortControllerRef.current = new AbortController();

    const [w, h] = resolution === '1080p' ? [1920, 1080] : [1280, 720];

    try {
      const { blob, filename } = await renderVideo({
        audioFile: mergedData.audioFile,
        rows: mergedData.rows,
        slides: mergedData.slides,
        imageUrls: mergedData.effectiveImageUrls,
        duration: mergedData.duration,
        title: projectTitle,
        width: w,
        height: h,
        fps: 30,
        animationMode,
        slideAnimations: mergedData.slideAnimations,
        captionStyle,
        onProgress: (pct, msg) => {
          setExportProgress(pct);
          setExportStatus(msg);
        },
        abortSignal: abortControllerRef.current.signal,
      });

      downloadBlob(blob, filename);
      setExportStatus(`Export complete! Saved as ${filename}`);
    } catch (err) {
      if (err.message !== 'Render cancelled') {
        setExportStatus(`Export error: ${err.message}`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  // Subtitle Exporters for Merged Video
  const handleExportSrt = () => {
    if (!mergedData) return;
    const text = generateSrt(mergedData.rows, mergedData.slides, mergedData.duration);
    const safeTitle = (projectTitle || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadText(text, `${safeTitle}.srt`, 'text/plain;charset=utf-8');
  };

  const handleExportVtt = () => {
    if (!mergedData) return;
    const text = generateVtt(mergedData.rows, mergedData.slides, mergedData.duration);
    const safeTitle = (projectTitle || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadText(text, `${safeTitle}.vtt`, 'text/vtt;charset=utf-8');
  };

  const handleExportJson = () => {
    if (!mergedData) return;
    const json = generateTimelineJson(
      projectTitle,
      mergedData.rows,
      mergedData.slides,
      mergedData.duration,
      [],
      mergedData.slideAnimations
    );
    const safeTitle = (projectTitle || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadText(json, `${safeTitle}_timeline.json`, 'application/json;charset=utf-8');
  };

  // Download All Images across all sections
  const handleDownloadAllImages = () => {
    if (!mergedData?.effectiveImageUrls) return;
    mergedData.effectiveImageUrls.forEach((url, idx) => {
      if (!url) return;
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `slide_${idx + 1}.jpg`;
        a.click();
      }, idx * 250);
    });
  };

  return (
    <main>
      <header>
        <div className="header-badge">Video Maker Studio v2.0 • Multi-Section Architecture</div>
        <h1>Multi-Section Video Maker</h1>
        <p>
          Organize your video into sections with independent voiceover, script, images, manual replacement, and video previews.
          Then merge all sections into one seamless master video!
        </p>
      </header>

      {/* Global Project Configuration */}
      <section className="global-config-section">
        <div className="section-header-row">
          <div>
            <h2>Global Settings &amp; AI Studio</h2>
            <p className="hint">Configure project metadata, AI image generation, animation, and caption styles.</p>
          </div>
        </div>

        <div className="grid-2">
          <label>
            Project Title:
            <input
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="e.g. History of Space Exploration"
            />
          </label>

          <label>
            Whisper Speech-to-Text Model:
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="image-gen-grid" style={{ marginTop: '14px' }}>
          <label>
            Image Generation Engine:
            <select
              value={imageEngine}
              onChange={(e) => setImageEngine(e.target.value)}
            >
              {IMAGE_ENGINES.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Visual Style Preset:
            <select
              value={visualStyle}
              onChange={(e) => setVisualStyle(e.target.value)}
            >
              {IMAGE_STYLES.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Google AI Studio API Key with Verify Button */}
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
                <button
                  type="button"
                  className="ghost small-btn"
                  disabled={isVerifying || !apiKey.trim()}
                  onClick={handleVerifyApiKey}
                  title="Test your API key to make sure it works"
                >
                  {isVerifying ? '⏳ Verifying…' : '🔑 Verify'}
                </button>
              </div>
              {apiKeyStatus && (
                <div className={`api-key-status ${apiKeyStatus.valid ? 'valid' : 'invalid'}`}>
                  {apiKeyStatus.message}
                </div>
              )}
              <small>
                Get your key at{' '}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="link-highlight"
                >
                  aistudio.google.com
                </a>{' '}
                (saved in browser localStorage).
              </small>
            </label>
          </div>
        )}

        {/* Global Animation & Subtitle Presets */}
        <div className="animation-options-grid" style={{ marginTop: '14px' }}>
          <label>
            Slide Entry Animation Mode:
            <select
              value={animationMode}
              onChange={(e) => setAnimationMode(e.target.value)}
            >
              {ANIMATION_TYPES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <small className="hint">
              Rules active: Animate enter only (no exit transitions). Timestamps ≤ 2.5s skip animation.
            </small>
          </label>

          <label>
            Caption / Subtitle Style:
            <select
              value={captionStyle}
              onChange={(e) => setCaptionStyle(e.target.value)}
            >
              {CAPTION_STYLES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* Sections Control Panel: Provision to choose how many sections needed */}
      <section className="sections-control-panel">
        <div className="sections-control-header">
          <div>
            <h2>Video Sections ({sections.length})</h2>
            <p className="hint">
              Select how many sections you need or add sections dynamically. Each section has its own script, voice, images, and video preview.
            </p>
          </div>

          <button
            type="button"
            className="add-section-btn"
            onClick={handleAddSection}
            title="Add a new section"
          >
            + Add New Section
          </button>
        </div>

        {/* Quick Section Count Selector Pills */}
        <div className="section-selector-pills">
          <span style={{ fontSize: '0.82rem', color: '#94a3b8', marginRight: '4px' }}>
            Quick Count:
          </span>
          {[1, 2, 3, 4, 5, 6].map((num) => (
            <button
              key={num}
              type="button"
              className={`section-count-pill ${sections.length === num ? 'active' : ''}`}
              onClick={() => setSectionCount(num)}
            >
              {num} {num === 1 ? 'Section' : 'Sections'}
            </button>
          ))}
        </div>
      </section>

      {/* Section Editors List */}
      <div className="sections-container">
        {sections.map((section, idx) => (
          <SectionEditor
            key={section.id}
            section={section}
            sectionIndex={idx}
            totalSections={sections.length}
            apiKey={apiKey}
            imageEngine={imageEngine}
            visualStyle={visualStyle}
            animationMode={animationMode}
            captionStyle={captionStyle}
            whisperModel={model}
            transcribeFn={transcribe}
            onUpdateSection={(updater) => handleUpdateSection(idx, updater)}
            onRemoveSection={() => handleRemoveSection(idx)}
            onPreviewImage={(url, title) => setPreviewModalData({ url, title })}
          />
        ))}
      </div>

      {/* Big Action Bar: Merge All Sections into Final Video */}
      <div className="merge-action-card">
        <button
          type="button"
          className="big-merge-btn"
          disabled={isMerging}
          onClick={handleMergeAllSections}
        >
          {isMerging ? '⏳ Merging Audio & Slides…' : '🎬 Merge All Sections into Final Video'}
        </button>
        <p className="hint" style={{ marginTop: '8px' }}>
          Stitches voice recordings, timestamps, slides, and visuals of all {sections.length} sections into one master video.
        </p>
        {mergeError && <div className="error-banner">{mergeError}</div>}
      </div>

      {/* Master Merged Final Video Studio */}
      {mergedData && (
        <section className="merged-studio-section">
          <div className="merged-header-bar">
            <div>
              <h2>🌟 Master Merged Video Studio</h2>
              <span className="badge badge-success">
                {mergedData.rows.length} Total Slides • {fmt(mergedData.duration)} Total Duration
              </span>
            </div>
          </div>

          <p className="hint">
            All sections have been concatenated seamlessly! Preview the complete video, scrub through the master timeline, or export in full quality.
          </p>

          {/* Master Canvas Video Preview */}
          <div className="video-player-frame">
            <canvas
              ref={mergedCanvasRef}
              width={1280}
              height={720}
              className="preview-canvas"
            />
          </div>

          {/* Hidden Audio Player for Merged Playback */}
          {mergedData.audioUrl && (
            <audio
              ref={mergedAudioRef}
              src={mergedData.audioUrl}
              onPlay={() => setMergedPlaying(true)}
              onPause={() => setMergedPlaying(false)}
              onEnded={() => setMergedPlaying(false)}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setMergedCurrentTime(t);
                if (!mergedPlaying) renderMergedPreview(t);
              }}
              style={{ display: 'none' }}
            />
          )}

          {/* Master Visual Timeline */}
          <VisualTimeline
            rows={mergedData.rows}
            slides={mergedData.slides}
            duration={mergedData.duration}
            currentTime={mergedCurrentTime}
            isPlaying={mergedPlaying}
            imageUrls={mergedData.effectiveImageUrls}
            animationMode={animationMode}
            slideAnimations={mergedData.slideAnimations}
            onSeek={handleMergedSeek}
            onTogglePlay={() => {
              if (mergedAudioRef.current) {
                if (mergedAudioRef.current.paused) mergedAudioRef.current.play();
                else mergedAudioRef.current.pause();
              }
            }}
          />

          {/* Master Slide Ellipse Drawer with Manual Replace Option */}
          <SlideEllipseDrawer
            drawerTitle="Master Slides &amp; Visuals Shelf"
            rows={mergedData.rows}
            slides={mergedData.slides}
            duration={mergedData.duration}
            currentTime={mergedCurrentTime}
            effectiveImageUrls={mergedData.effectiveImageUrls}
            generatedImages={{}}
            manualImages={{}}
            animationMode={animationMode}
            slideAnimations={mergedData.slideAnimations}
            slidePrompts={{}}
            onSetSlideAnimation={(idx, anim) => {
              setMergedData((prev) => ({
                ...prev,
                slideAnimations: { ...prev.slideAnimations, [idx]: anim },
              }));
              setTimeout(() => renderMergedPreview(mergedCurrentTime), 20);
            }}
            onSetSlidePrompt={() => {}}
            onGenerateSlideImage={() => {}}
            onReplaceSlideImage={(idx, file) => {
              const url = URL.createObjectURL(file);
              setMergedData((prev) => {
                const nextUrls = [...prev.effectiveImageUrls];
                nextUrls[idx] = url;
                return { ...prev, effectiveImageUrls: nextUrls };
              });
              setTimeout(() => renderMergedPreview(mergedCurrentTime), 30);
            }}
            onPreviewImage={(idx) => {
              const url = mergedData.effectiveImageUrls[idx];
              if (url) setPreviewModalData({ url, title: `Merged Slide #${idx + 1}` });
            }}
            onSeek={handleMergedSeek}
          />

          {/* Master Export Controls */}
          <div className="export-controls-bar" style={{ marginTop: '24px' }}>
            <div className="export-options-row">
              <label>
                Export Resolution:
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  disabled={isExporting}
                >
                  <option value="720p">720p HD (Fast &amp; Crisp - 1280x720)</option>
                  <option value="1080p">1080p Full HD (Studio Quality - 1920x1080)</option>
                </select>
              </label>

              <button
                type="button"
                className="primary-btn export-btn"
                disabled={isExporting}
                onClick={handleExportMergedVideo}
              >
                {isExporting ? '⏳ Rendering Video…' : '📥 Export & Download Full Video'}
              </button>

              <button
                type="button"
                className="ghost"
                onClick={handleExportSrt}
              >
                📄 Subtitles (.srt)
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleExportVtt}
              >
                📄 Subtitles (.vtt)
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleExportJson}
              >
                📊 Timeline (.json)
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleDownloadAllImages}
              >
                💾 Download All Images
              </button>
            </div>

            {isExporting && (
              <div className="export-progress-panel">
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill animated"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
                <div className="export-progress-info">
                  <span>{exportStatus}</span>
                  <strong>{exportProgress}%</strong>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Full-Screen Image Lightbox Modal */}
      {previewModalData && (
        <ImagePreviewModal
          isOpen={Boolean(previewModalData)}
          images={[previewModalData.url]}
          currentIndex={0}
          onClose={() => setPreviewModalData(null)}
          onSelectIndex={() => {}}
        />
      )}
    </main>
  );
}

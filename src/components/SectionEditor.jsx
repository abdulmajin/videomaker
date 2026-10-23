import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { readDoc } from '../lib/readDoc';
import { parseScript, matchImages } from '../lib/parseScript';
import { decodeAudio } from '../lib/audio';
import { alignSlides } from '../lib/align';
import { preloadImages, drawVideoFrame } from '../lib/renderVideo';
import { enhancePrompt, generateSlideImage } from '../lib/imageGen';
import VisualTimeline from './VisualTimeline';
import SlideEllipseDrawer from './SlideEllipseDrawer';

const fmt = (s) => {
  if (isNaN(s) || s < 0) s = 0;
  const mins = Math.floor(s / 60);
  const secs = (s % 60).toFixed(1);
  return `${String(mins).padStart(2, '0')}:${secs.padStart(4, '0')}`;
};

export default function SectionEditor({
  section,
  sectionIndex,
  totalSections,
  apiKey = '',
  imageEngine = 'google-imagen',
  visualStyle = 'cinematic',
  animationMode = 'random',
  captionStyle = 'modern-card',
  whisperModel = 'Xenova/whisper-tiny.en',
  transcribeFn,
  onUpdateSection,
  onRemoveSection,
  onPreviewImage,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStatus, setTranscribeStatus] = useState('');
  const [localError, setLocalError] = useState('');

  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const preloadedImagesRef = useRef([]);

  // Compute slides and image URLs for this section
  const slides = useMemo(() => parseScript(section.scriptText || ''), [section.scriptText]);

  const matched = useMemo(
    () => matchImages(slides, section.images || []),
    [slides, section.images]
  );

  const matchedUrls = useMemo(
    () => matched.map((f) => (f ? URL.createObjectURL(f) : null)),
    [matched]
  );

  // Effective image URLs: Priority = Manual Replaced Image > AI Generated Image > Uploaded Match
  const effectiveImageUrls = useMemo(() => {
    return slides.map((s, i) => {
      if (section.manualImages?.[i]?.url) return section.manualImages[i].url;
      if (section.generatedImages?.[i]?.url) return section.generatedImages[i].url;
      if (matchedUrls[i]) return matchedUrls[i];
      return null;
    });
  }, [slides, section.manualImages, section.generatedImages, matchedUrls]);

  // Push computed slides & effectiveImageUrls up to section state for merging
  useEffect(() => {
    onUpdateSection((prev) => ({
      ...prev,
      slides,
      effectiveImageUrls,
    }));
  }, [slides, effectiveImageUrls]);

  // Preload images for canvas preview
  useEffect(() => {
    let active = true;
    preloadImages(effectiveImageUrls).then((imgs) => {
      if (active) preloadedImagesRef.current = imgs;
    });
    return () => {
      active = false;
    };
  }, [effectiveImageUrls]);

  // Canvas frame renderer
  const renderCurrentPreview = useCallback(
    (t) => {
      const canvas = canvasRef.current;
      if (!canvas || !section.rows?.length) return;
      const ctx = canvas.getContext('2d');
      drawVideoFrame({
        ctx,
        width: canvas.width,
        height: canvas.height,
        time: t,
        duration: section.duration || 1,
        rows: section.rows,
        slides,
        preloadedImages: preloadedImagesRef.current,
        animationMode,
        slideAnimations: section.slideAnimations || {},
        captionStyle,
        title: '', // Rule: Title should NOT appear on video
      });
    },
    [section.rows, section.duration, slides, animationMode, section.slideAnimations, captionStyle]
  );

  // Playback animation loop
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      renderCurrentPreview(currentTime);
      return;
    }

    function loop() {
      if (audioRef.current) {
        const t = audioRef.current.currentTime;
        setCurrentTime(t);
        renderCurrentPreview(t);
      }
      animFrameRef.current = requestAnimationFrame(loop);
    }

    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, renderCurrentPreview, currentTime]);

  // Audio file selection
  const handleAudioChange = async (file) => {
    if (!file) return;
    setLocalError('');
    try {
      const { duration } = await decodeAudio(file);
      const audioUrl = URL.createObjectURL(file);
      onUpdateSection((prev) => ({
        ...prev,
        audio: file,
        audioUrl,
        duration,
        rows: [], // Reset alignment on audio change
      }));
    } catch (err) {
      setLocalError(`Audio decode error: ${err.message}`);
    }
  };

  // Script file selection (.pdf, .docx, .txt, .csv)
  const handleScriptFile = async (file) => {
    if (!file) return;
    setLocalError('');
    try {
      const text = await readDoc(file);
      onUpdateSection((prev) => ({
        ...prev,
        scriptText: text,
        uploadedDocName: file.name,
        rows: [],
      }));
    } catch (err) {
      setLocalError(`Could not read script file: ${err.message}`);
    }
  };

  // Transcribe & Align for this section
  const handleTranscribeAndAlign = async () => {
    if (!section.audio) {
      setLocalError('Please upload voiceover audio for this section.');
      return;
    }
    if (!slides.length) {
      setLocalError('Please add script text or upload a script file for this section.');
      return;
    }

    setLocalError('');
    setIsTranscribing(true);
    setTranscribeStatus('Decoding audio…');

    try {
      const { samples, duration } = await decodeAudio(section.audio);
      const words = await transcribeFn(samples, whisperModel, setTranscribeStatus);
      const aligned = alignSlides(slides, words, duration);

      onUpdateSection((prev) => ({
        ...prev,
        duration,
        words,
        rows: aligned,
      }));

      setTranscribeStatus('');
      setTimeout(() => renderCurrentPreview(0), 100);
    } catch (err) {
      setLocalError(`Transcription error: ${err.message}`);
      setTranscribeStatus('');
    } finally {
      setIsTranscribing(false);
    }
  };

  // Manual replace of an image for a specific slide
  const handleReplaceSlideImage = (slideIndex, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    onUpdateSection((prev) => ({
      ...prev,
      manualImages: {
        ...(prev.manualImages || {}),
        [slideIndex]: { file, url },
      },
    }));
    setTimeout(() => renderCurrentPreview(currentTime), 60);
  };

  // Generate single AI image for a specific slide in this section
  const handleGenerateSlideImage = async (slideIndex) => {
    const slide = slides[slideIndex];
    if (!slide) return;
    const prompt = section.slidePrompts?.[slideIndex] || slide.text;
    if (!prompt) return;

    if (imageEngine === 'google-imagen' && !apiKey.trim()) {
      setLocalError('Google AI Studio API key is missing. Please enter your API key in global settings.');
      return;
    }

    setLocalError('');
    setIsGenerating(true);
    setGenStatus(`Generating image for Slide #${slide.id}…`);

    try {
      const res = await generateSlideImage({
        prompt,
        apiKey,
        engine: imageEngine,
        style: visualStyle,
      });

      const url = URL.createObjectURL(res.blob);
      onUpdateSection((prev) => ({
        ...prev,
        generatedImages: {
          ...(prev.generatedImages || {}),
          [slideIndex]: { blob: res.blob, url, prompt, engine: res.engine },
        },
      }));
      setGenStatus(`✨ Slide #${slide.id} image ready!`);
      setTimeout(() => renderCurrentPreview(currentTime), 60);
    } catch (err) {
      setLocalError(`AI generation error: ${err.message}`);
      setGenStatus('');
    } finally {
      setIsGenerating(false);
    }
  };

  // Batch generate all images for this section
  const handleGenerateAllSectionImages = async () => {
    if (!slides.length) {
      setLocalError('No slides detected in this section.');
      return;
    }
    if (imageEngine === 'google-imagen' && !apiKey.trim()) {
      setLocalError('Please enter your Google AI Studio API key in the global settings.');
      return;
    }

    setLocalError('');
    setIsGenerating(true);

    try {
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const prompt = section.slidePrompts?.[i] || slide.text;
        setGenStatus(`Generating Slide #${slide.id} (${i + 1}/${slides.length})…`);

        const res = await generateSlideImage({
          prompt,
          apiKey,
          engine: imageEngine,
          style: visualStyle,
        });

        const url = URL.createObjectURL(res.blob);
        onUpdateSection((prev) => ({
          ...prev,
          generatedImages: {
            ...(prev.generatedImages || {}),
            [i]: { blob: res.blob, url, prompt, engine: res.engine },
          },
        }));

        setTimeout(() => renderCurrentPreview(currentTime), 30);
        if (i < slides.length - 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      setGenStatus(`🎉 Generated all ${slides.length} images for ${section.title}!`);
    } catch (err) {
      setLocalError(`Generation error: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSeek = (t) => {
    const clamped = Math.max(0, Math.min(section.duration || 1, t));
    setCurrentTime(clamped);
    if (audioRef.current) audioRef.current.currentTime = clamped;
    renderCurrentPreview(clamped);
  };

  const isCollapsed = section.isCollapsed || false;
  const isAligned = Boolean(section.rows?.length);

  return (
    <div className={`section-editor-box ${isCollapsed ? 'collapsed' : ''}`}>
      {/* 1. Section Header & Ellipse Toggle */}
      <div className="section-editor-header">
        <div className="section-title-area">
          <span className="section-number-pill">#{sectionIndex + 1}</span>
          <input
            type="text"
            className="section-title-input"
            value={section.title || `Section ${sectionIndex + 1}`}
            onChange={(e) =>
              onUpdateSection((prev) => ({ ...prev, title: e.target.value }))
            }
            placeholder={`Section ${sectionIndex + 1} Title...`}
          />
        </div>

        <div className="section-badges-area">
          <span className="badge badge-info">{slides.length} Slides</span>
          {section.duration > 0 && (
            <span className="badge badge-info">{fmt(section.duration)}</span>
          )}
          {isAligned ? (
            <span className="badge badge-success">✓ Aligned</span>
          ) : (
            <span className="badge badge-warn">⏳ Needs Alignment</span>
          )}

          {/* Ellipse Collapse/Expand Toggle Button */}
          <button
            type="button"
            className="drawer-toggle-btn"
            onClick={() =>
              onUpdateSection((prev) => ({
                ...prev,
                isCollapsed: !prev.isCollapsed,
              }))
            }
            title="Toggle collapse/expand section"
          >
            {isCollapsed ? '▼ Expand Section' : '▲ Collapse Section'}
          </button>

          {/* Remove Section Button */}
          {totalSections > 1 && (
            <button
              type="button"
              className="danger-btn small-btn"
              onClick={onRemoveSection}
              title="Remove this section"
            >
              ✕ Delete
            </button>
          )}
        </div>
      </div>

      {/* 2. Expanded Section Content */}
      {!isCollapsed && (
        <div className="section-editor-body">
          {/* Section Voice Audio */}
          <div className="section-subblock">
            <label className="section-subblock-title">
              🎙️ Voiceover Audio for {section.title}:
            </label>
            <div className="audio-upload-row">
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => handleAudioChange(e.target.files[0])}
              />
              {section.audioUrl && (
                <audio
                  ref={audioRef}
                  src={section.audioUrl}
                  controls
                  className="section-audio-player"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onTimeUpdate={(e) => {
                    const t = e.currentTarget.currentTime;
                    setCurrentTime(t);
                    if (!isPlaying) renderCurrentPreview(t);
                  }}
                />
              )}
            </div>
          </div>

          {/* Section Script & Slide Text */}
          <div className="section-subblock">
            <div className="section-subblock-header">
              <label className="section-subblock-title">
                📄 Script &amp; Slide Mapping for {section.title}:
              </label>
              <div className="input-mode-tabs compact">
                <button
                  type="button"
                  className={`input-mode-tab ${
                    (section.inputMode || 'doc') === 'doc' ? 'active' : ''
                  }`}
                  onClick={() =>
                    onUpdateSection((prev) => ({ ...prev, inputMode: 'doc' }))
                  }
                >
                  📁 Upload Document
                </button>
                <button
                  type="button"
                  className={`input-mode-tab ${
                    section.inputMode === 'textbox' ? 'active' : ''
                  }`}
                  onClick={() =>
                    onUpdateSection((prev) => ({ ...prev, inputMode: 'textbox' }))
                  }
                >
                  ✍️ Direct Text Box
                </button>
                <button
                  type="button"
                  className={`input-mode-tab ${
                    section.inputMode === 'images' ? 'active' : ''
                  }`}
                  onClick={() =>
                    onUpdateSection((prev) => ({ ...prev, inputMode: 'images' }))
                  }
                >
                  🖼️ Upload Images ({section.images?.length || 0})
                </button>
              </div>
            </div>

            {/* Document Upload Tab */}
            {(section.inputMode || 'doc') === 'doc' && (
              <div className="file-drop-card compact-card">
                <label className="file-upload-label">
                  <span className="file-upload-icon">📄</span>
                  <strong>Choose Script File (.pdf, .docx, .txt, or .csv)</strong>
                  <span className="file-upload-hint">
                    Each line becomes a slide (e.g. <code>Slide 1: The boy is playing</code>).
                  </span>
                  <input
                    type="file"
                    accept=".docx,.pdf,.txt,.csv"
                    className="hidden-file-input"
                    onChange={(e) => handleScriptFile(e.target.files[0])}
                  />
                  <span className="browse-files-btn">📂 Browse Script</span>
                </label>
                {section.uploadedDocName && (
                  <div className="uploaded-file-tag">
                    <span>✓ Loaded: <strong>{section.uploadedDocName}</strong></span>
                    <small>({slides.length} slides)</small>
                  </div>
                )}
              </div>
            )}

            {/* Direct Text Box Tab */}
            {section.inputMode === 'textbox' && (
              <div className="textbox-pane">
                <p className="hint">
                  Type your script for this section line by line. Example: <code>Slide 1: The boy is playing in the park</code>
                </p>
                <textarea
                  rows={5}
                  value={section.scriptText || ''}
                  onChange={(e) =>
                    onUpdateSection((prev) => ({
                      ...prev,
                      scriptText: e.target.value,
                    }))
                  }
                  placeholder={`Slide 1: Introduction to ${section.title}\nSlide 2: First key highlight\nSlide 3: Summary`}
                />
              </div>
            )}

            {/* Local Images Upload Tab */}
            {section.inputMode === 'images' && (
              <div className="images-upload-pane">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) =>
                    onUpdateSection((prev) => ({
                      ...prev,
                      images: [...e.target.files],
                    }))
                  }
                />
                <small className="hint">
                  {section.images?.length || 0} images uploaded for this section.
                </small>
              </div>
            )}
          </div>

          {/* Section AI Image Generation Bar */}
          <div className="section-ai-actions-bar">
            <button
              type="button"
              className="primary-btn small-btn"
              disabled={isGenerating || slides.length === 0}
              onClick={handleGenerateAllSectionImages}
            >
              {isGenerating ? '⏳ Generating…' : `✨ Generate AI Images for ${section.title}`}
            </button>
            {genStatus && <span className="status-inline">{genStatus}</span>}
          </div>

          {/* Transcribe & Timestamp Alignment Button */}
          <div className="section-align-row">
            <button
              type="button"
              className="align-section-btn"
              disabled={isTranscribing || !section.audio || slides.length === 0}
              onClick={handleTranscribeAndAlign}
            >
              {isTranscribing ? '⏳ Transcribing & Aligning…' : `🎯 Transcribe & Align ${section.title}`}
            </button>
            {transcribeStatus && <span className="status-inline">{transcribeStatus}</span>}
          </div>

          {localError && <div className="error-banner">{localError}</div>}

          {/* Section Video Preview (Live Canvas & Timeline) */}
          {isAligned && (
            <div className="section-preview-wrapper">
              <div className="section-preview-header">
                <h4>🎬 {section.title} - Video Preview</h4>
                <span className="badge badge-info">Preview Only</span>
              </div>

              <div className="video-player-frame section-frame">
                <canvas
                  ref={canvasRef}
                  width={1280}
                  height={720}
                  className="preview-canvas"
                />
              </div>

              {/* Section Timeline */}
              <VisualTimeline
                rows={section.rows}
                slides={slides}
                duration={section.duration || 1}
                currentTime={currentTime}
                isPlaying={isPlaying}
                imageUrls={effectiveImageUrls}
                animationMode={animationMode}
                slideAnimations={section.slideAnimations || {}}
                onSeek={handleSeek}
                onTogglePlay={() => {
                  if (audioRef.current) {
                    if (audioRef.current.paused) audioRef.current.play();
                    else audioRef.current.pause();
                  }
                }}
              />

              {/* Section Slide Ellipse Drawer with Manual Image Replacement */}
              <SlideEllipseDrawer
                drawerTitle={`${section.title} - Slides & Manual Image Replacement`}
                rows={section.rows}
                slides={slides}
                duration={section.duration || 1}
                currentTime={currentTime}
                effectiveImageUrls={effectiveImageUrls}
                generatedImages={section.generatedImages || {}}
                manualImages={section.manualImages || {}}
                animationMode={animationMode}
                slideAnimations={section.slideAnimations || {}}
                slidePrompts={section.slidePrompts || {}}
                onSetSlideAnimation={(idx, anim) => {
                  onUpdateSection((prev) => ({
                    ...prev,
                    slideAnimations: {
                      ...(prev.slideAnimations || {}),
                      [idx]: anim,
                    },
                  }));
                  setTimeout(() => renderCurrentPreview(currentTime), 20);
                }}
                onSetSlidePrompt={(idx, prompt) => {
                  onUpdateSection((prev) => ({
                    ...prev,
                    slidePrompts: {
                      ...(prev.slidePrompts || {}),
                      [idx]: prompt,
                    },
                  }));
                }}
                onGenerateSlideImage={handleGenerateSlideImage}
                onReplaceSlideImage={handleReplaceSlideImage}
                onPreviewImage={(idx) => {
                  if (effectiveImageUrls[idx]) {
                    onPreviewImage(effectiveImageUrls[idx], `Slide #${idx + 1}`);
                  }
                }}
                onSeek={handleSeek}
                isGenerating={isGenerating}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

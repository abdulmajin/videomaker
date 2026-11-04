import { useState, useMemo } from 'react';

const DEFAULT_CHARACTER_LOCK = `Minimalist storybook sketch illustration of the consistent male empath character with oversized round white face, messy spiky brown hair with rough irregular strokes, tiny black dot eyes, subtle eyebrows, tiny minimal mouth, thin black stick arms and legs, small simplified body, exaggerated head-to-body ratio, wearing a brown shirt and dark pants, thick rough black outlines, imperfect hand-drawn strokes, flat simple 2D colors, pure white background, subtle soft gray ground shadow under feet, 16:9 widescreen full-frame composition with bottom 15% clean white caption-safe space, no 3D, no photorealism, no anime, no complex background`;

export default function MasterPromptModal({
  isOpen,
  onClose,
  onApplyToSection,
  sections = [],
  activeSectionIndex = 0,
}) {
  const [scriptInput, setScriptInput] = useState('');
  const [characterStyle, setCharacterStyle] = useState('cartoon-empath');
  const [granularity, setGranularity] = useState('comma'); // 'comma' | 'sentence'
  const [firstSlideIsPoster, setFirstSlideIsPoster] = useState(true);
  const [targetSectionIdx, setTargetSectionIdx] = useState(activeSectionIndex);
  const [generatedSlides, setGeneratedSlides] = useState([]);
  const [activeTab, setActiveTab] = useState('input'); // 'input' | 'preview'

  // Prompt Splitting settings (Default: 24 for Google Flow)
  const [enableSplit, setEnableSplit] = useState(true);
  const [splitSize, setSplitSize] = useState(24);
  const [splitDividerStyle, setSplitDividerStyle] = useState('header'); // 'header' | 'blank'

  // Copy feedback notices
  const [copiedNotice, setCopiedNotice] = useState('');

  // Split generated slides into batches of `effectiveSplitSize`
  const effectiveSplitSize = enableSplit ? Math.max(1, Number(splitSize) || 24) : 0;

  const promptBatches = useMemo(() => {
    if (!generatedSlides.length) return [];
    if (!effectiveSplitSize || effectiveSplitSize >= generatedSlides.length) {
      return [
        {
          batchIndex: 1,
          startSlide: 1,
          endSlide: generatedSlides.length,
          slides: generatedSlides,
        },
      ];
    }
    const batches = [];
    for (let i = 0; i < generatedSlides.length; i += effectiveSplitSize) {
      const chunk = generatedSlides.slice(i, i + effectiveSplitSize);
      batches.push({
        batchIndex: batches.length + 1,
        startSlide: chunk[0].id,
        endSlide: chunk[chunk.length - 1].id,
        slides: chunk,
      });
    }
    return batches;
  }, [generatedSlides, effectiveSplitSize]);

  if (!isOpen) return null;

  function triggerNotice(msg) {
    setCopiedNotice(msg);
    setTimeout(() => setCopiedNotice(''), 2500);
  }

  function downloadTxtFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Split script into granular clauses or sentences
  function parseScriptToClauses(text, mode) {
    if (!text.trim()) return [];

    // If user pasted already-numbered "Slide 1: ..." lines, preserve each line if line-structured
    const rawLines = text
      .split(/\r?\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    const hasSlidePrefix = rawLines.length > 1 && rawLines.every((l) => /^slide\s*\d+\s*[:\-.]/i.test(l));
    if (hasSlidePrefix) {
      return rawLines
        .map((l) => l.replace(/^slide\s*\d+\s*[:\-.]\s*/i, '').trim())
        .filter(Boolean);
    }

    const clean = text.replace(/^slide\s*\d+\s*[:\-.]\s*/gim, '');
    let parts = [];

    if (mode === 'comma') {
      parts = clean
        .split(/(?<=[,;:.?!])\s+|\r?\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 2);
    } else {
      parts = clean
        .split(/(?<=[.?!])\s+|\r?\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 2);
    }

    return parts.length ? parts : [text.trim()];
  }

  // Extracts punchy 2-3 word retention hook from clause
  function extractHook(text) {
    const clean = text.replace(/[^a-zA-Z\s]/g, '').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    if (!words.length) return 'WATCH THIS';
    if (words.length <= 3) return words.join(' ').toUpperCase();
    return words.slice(0, 3).join(' ').toUpperCase();
  }

  // Generates storyboard slides with prompts and retention hooks
  function handleGenerate() {
    const clauses = parseScriptToClauses(scriptInput, granularity);
    if (!clauses.length) return;

    let timeSec = 0;
    const slides = clauses.map((clause, idx) => {
      const dur = Math.max(2.5, Math.min(5.5, clause.split(' ').length * 0.45));
      const startMin = Math.floor(timeSec / 60);
      const startSec = Math.floor(timeSec % 60);
      const endMin = Math.floor((timeSec + dur) / 60);
      const endSec = Math.floor((timeSec + dur) % 60);
      const timecode = `${String(startMin).padStart(2, '0')}:${String(startSec).padStart(2, '0')} - ${String(
        endMin
      ).padStart(2, '0')}:${String(endSec).padStart(2, '0')}`;
      timeSec += dur;

      const hook = extractHook(clause);
      const isTitlePoster = idx === 0 && firstSlideIsPoster;
      let styleDesc = '';

      if (characterStyle === 'cartoon-empath') {
        if (isTitlePoster) {
          styleDesc = `${DEFAULT_CHARACTER_LOCK}, 16:9 YouTube chapter thumbnail poster layout featuring the male empath character alongside bold clean hand-lettered title text reading "${clause.replace(/"/g, '')}" in perfect title font`;
        } else {
          styleDesc = `${DEFAULT_CHARACTER_LOCK}, directly depicting physical action and emotion: ${clause}`;
        }
      } else {
        if (isTitlePoster) {
          styleDesc = `Cinematic 16:9 widescreen title poster thumbnail, dramatic lighting, bold clean title typography reading "${clause.replace(/"/g, '')}", depicting: ${clause}`;
        } else {
          styleDesc = `Cinematic 16:9 widescreen photograph, dramatic lighting, detailed composition, depicting: ${clause}`;
        }
      }

      return {
        id: idx + 1,
        sentence: clause,
        hook,
        concept: clause.slice(0, 50),
        timecode,
        prompt: styleDesc,
      };
    });

    setGeneratedSlides(slides);
    setActiveTab('preview');
  }

  // Build Slide Mapping text ("Slide 1: ...\nSlide 2: ...")
  function buildSlideMappingText() {
    return generatedSlides.map((s) => `Slide ${s.id}: ${s.sentence}`).join('\n');
  }

  // Build Image Prompts text for a single batch ("slide 1: ...\nslide 2: ...")
  function buildBatchPromptsText(batchSlides) {
    return batchSlides.map((s) => `slide ${s.id}: ${s.prompt}`).join('\n');
  }

  // Build ALL Image Prompts in 1 single file (with optional splitting every N prompts)
  function buildAllPromptsSingleFileText() {
    if (!generatedSlides.length) return '';

    if (!enableSplit || promptBatches.length <= 1) {
      return buildBatchPromptsText(generatedSlides);
    }

    return promptBatches
      .map((batch) => {
        const lines = buildBatchPromptsText(batch.slides);
        if (splitDividerStyle === 'header') {
          return `=== BATCH ${batch.batchIndex} (Slides ${batch.startSlide} - ${batch.endSlide}) ===\n${lines}`;
        }
        return lines;
      })
      .join('\n\n');
  }

  // Download all image prompts in 1 single .txt file
  function handleDownloadAllPromptsTxt() {
    if (!generatedSlides.length) return;
    const content = buildAllPromptsSingleFileText();
    const splitTag = enableSplit && promptBatches.length > 1 ? `_split_${effectiveSplitSize}` : '';
    downloadTxtFile(content, `image_prompts_all_${generatedSlides.length}_slides${splitTag}.txt`);
    triggerNotice('✓ Downloaded All Image Prompts (.txt)');
  }

  // Download Slide Mapping in 1 single .txt file
  function handleDownloadSlideMappingTxt() {
    if (!generatedSlides.length) return;
    const content = buildSlideMappingText();
    downloadTxtFile(content, `slide_mapping_${generatedSlides.length}_slides.txt`);
    triggerNotice('✓ Downloaded Slide Mapping (.txt)');
  }

  // Copy All Image Prompts
  function handleCopyAllPrompts() {
    if (!generatedSlides.length) return;
    navigator.clipboard.writeText(buildAllPromptsSingleFileText());
    triggerNotice('✓ Copied All Image Prompts!');
  }

  // Copy Slide Mapping
  function handleCopySlideMapping() {
    if (!generatedSlides.length) return;
    navigator.clipboard.writeText(buildSlideMappingText());
    triggerNotice('✓ Copied Slide Mapping!');
  }

  // Copy a specific split batch (e.g. Batch 1: Slides 1-24 for Google Flow)
  function handleCopyBatch(batch) {
    const text = buildBatchPromptsText(batch.slides);
    navigator.clipboard.writeText(text);
    triggerNotice(`✓ Copied Batch ${batch.batchIndex} (Slides ${batch.startSlide}–${batch.endSlide})!`);
  }

  // Download a specific split batch
  function handleDownloadBatch(batch) {
    const text = buildBatchPromptsText(batch.slides);
    downloadTxtFile(text, `image_prompts_batch_${batch.batchIndex}_slides_${batch.startSlide}_to_${batch.endSlide}.txt`);
    triggerNotice(`✓ Downloaded Batch ${batch.batchIndex} (Slides ${batch.startSlide}–${batch.endSlide})!`);
  }

  // Apply directly to target section
  function handleApply() {
    if (!generatedSlides.length) return;

    const scriptText = buildSlideMappingText();
    const slidePrompts = {};
    const textOverlays = {};

    generatedSlides.forEach((s, idx) => {
      slidePrompts[idx] = s.prompt;
      textOverlays[idx] = s.hook;
    });

    onApplyToSection(targetSectionIdx, {
      scriptText,
      slidePrompts,
      textOverlays,
      uploadedDocName: 'Generated Storyboard',
    });

    onClose();
  }

  // Copy Mother Master Prompt template with script injected
  function handleCopyMotherPrompt() {
    const splitInstruction = enableSplit
      ? `Split the image prompts inside the single block into clearly separated batches of ${effectiveSplitSize} prompts per batch (e.g. Slides 1–${effectiveSplitSize}, Slides ${effectiveSplitSize + 1}–${effectiveSplitSize * 2}, etc.) so they can be pasted directly into Google Flow (${effectiveSplitSize} images at a time).`
      : `Provide all image prompts sequentially in a single block.`;

    const motherPrompt = `# SYSTEM & ROLE INSTRUCTION
You are an expert Storyboard Director, Prompt Engineer, and Video Production Specialist for the AI Video Maker Studio.
Your task is to take a narration script and break it down into separate Section Entities (Intro, Section 1, Section 2, etc.).
For EACH section, you will generate TWO distinct, ready-to-copy TXT blocks (NO CSV tables):
1. Video Maker Script Mapping TXT (restarting at Slide 1 for every section)
2. Image Generation Prompts TXT (numbered "slide 1: prompt", "slide 2: prompt"... matching each slide 1-to-1, split into batches of ${effectiveSplitSize || 24} inside the single block for Google Flow)

---
### STRICT RULES & PROJECT COMPATIBILITY INSTRUCTIONS:

1. **SEPARATE SECTION ENTITIES (RESTART AT SLIDE 1 IN EVERY SECTION)**:
   - Divide the script into its natural sections (starting with Intro, followed by Section 1, Section 2, etc.).
   - Never combine all sections together. Treat every section as a completely separate entity.
   - Slide numbering MUST always start from \`Slide 1\` / \`slide 1\` at the beginning of EVERY section (never continue numbering from the previous section).

2. **SECTION TITLE SLIDE & THUMBNAIL POSTER RULE**:
   - Do NOT skip the Section Title in the script: include the spoken title of each section as \`Slide 1\` of that section (except for the Intro hook, which starts directly with the first hook clause).
   - **CRITICAL EXCLUSION**: NEVER write the meta-words "Intro", "Section", "Section 1", "Section 2", or "Conclusion" inside the \`Slide X:\` spoken script text or inside the \`slide X:\` image generation prompts. Use ONLY the actual creative title words.
   - For \`slide 1\` of every section (excluding the Intro), make the Image Prompt look like a **16:9 YouTube Thumbnail / Chapter Poster** featuring the main character alongside bold, clean hand-lettered title typography displaying ONLY that section's title text.

3. **GRANULAR ACTION BREAKDOWN & BATCH SPLITTING (${effectiveSplitSize || 24} PER SPLIT)**:
   - Break down the narration clause-by-clause, action-by-action, or at every natural pause/comma (,).
   - Every single slide prompt must directly depict the physical action, verb, body language, or emotion described in that exact clause (e.g., if the script says "she walked away", show her walking away into the distance while the protagonist stands looking).
   - The number of \`slide 1:, slide 2:...\` image prompts in a section MUST match the exact number of \`Slide 1:, Slide 2:...\` script lines in that section.
   - ${splitInstruction}

4. **CHARACTER CONSISTENCY LOCK (REPEAT VERBATIM IN EVERY IMAGE PROMPT)**:
   Every generated image prompt MUST be a single line and include this exact character and style description verbatim:
   - **Character**: Male empath character. Oversized round white/off-white face, messy spiky brown hair with rough irregular strokes, tiny black dot eyes, subtle eyebrows, tiny minimal mouth, thin black stick arms and legs, small simplified body, exaggerated head-to-body ratio, primitive storybook cartoon appearance.
   - **Outfit**: Brown shirt, dark pants.
   - **Art Style**: Thick rough black outlines, imperfect hand-drawn sketch strokes, flat simple 2D colors, minimal details, clean solid pure white background, subtle light gray ground shadow under feet.
   - **16:9 Full-Screen & Caption Safe-Zone**: 16:9 widescreen full-frame composition, main character and visual action centered in the upper/middle 80% of the canvas, leaving the bottom 15% clean white space for animated bottom captions.
   - **Consistency Rule**: Keep face shape, hairstyle, proportions, clothing, and line thickness 100% IDENTICAL across all slides. Only change pose, facial expression, gestures, and essential minimalist props.
   - **Negative Constraints**: NO realistic humans, NO 3D rendering, NO photorealism, NO anime, NO complex backgrounds, NO shading gradients, NO extra clutter, NO meta-labels ("Section 1", "Intro", "Conclusion").

---
### OUTPUT FORMAT (REPEAT BOTH TXT BLOCKS FOR EACH SECTION SEPARATELY — NO CSV TABLE):

For EACH section (Intro, Section 1, Section 2, etc.), output ONLY these two copy-pasteable TXT code blocks:

#### [SECTION HEADER — e.g., INTRO / SECTION 1 / SECTION 2]

**1. VIDEO MAKER SCRIPT MAPPING TXT (1 Single File — Copy or Download)**
\`\`\`txt
Slide 1: [Exact spoken clause or section title — NO words like "Intro", "Section 1", or "Conclusion"]
Slide 2: [Next spoken clause]
Slide 3: [Next spoken clause]
\`\`\`

**2. IMAGE GENERATION PROMPTS TXT (1 Single File Split Every ${effectiveSplitSize || 24} Prompts for Google Flow)**
\`\`\`txt
=== BATCH 1 (Slides 1 - ${effectiveSplitSize || 24}) ===
slide 1: [Full single-line standalone Image Prompt with Character Consistency Lock + Scene Action/Poster Title + 16:9 Caption-Safe Framing + Negative Constraints]
slide 2: [Full single-line standalone Image Prompt with Character Consistency Lock + Scene Action + 16:9 Caption-Safe Framing + Negative Constraints]
slide 3: [Full single-line standalone Image Prompt with Character Consistency Lock + Scene Action + 16:9 Caption-Safe Framing + Negative Constraints]
\`\`\`

---
### SCRIPT:
${scriptInput || '[PASTE YOUR FULL NARRATION SCRIPT HERE]'}
`;
    navigator.clipboard.writeText(motherPrompt);
    triggerNotice('✓ Copied Mother Master Prompt!');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="master-prompt-modal-box" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header-row">
          <div>
            <div className="badge badge-info" style={{ marginBottom: '6px' }}>✨ In-App AI Storyboard Studio</div>
            <h2 style={{ margin: 0, fontSize: '1.35rem' }}>Master Storyboard &amp; Prompt Generator</h2>
            <p className="hint" style={{ margin: '4px 0 0 0' }}>
              Generate numbered <code>slide 1: prompt</code> files and <code>Slide 1: script</code> mappings with automatic batch splitting (e.g. 24 per split for Google Flow).
            </p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {copiedNotice && (
          <div className="storyboard-toast-notice">{copiedNotice}</div>
        )}

        {/* Modal Tabs */}
        <div className="input-mode-tabs" style={{ marginTop: '16px' }}>
          <button
            type="button"
            className={`input-mode-tab ${activeTab === 'input' ? 'active' : ''}`}
            onClick={() => setActiveTab('input')}
          >
            ✍️ Script &amp; Splitting Setup
          </button>
          <button
            type="button"
            className={`input-mode-tab ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
            disabled={!generatedSlides.length}
          >
            📊 Storyboard &amp; Downloads ({generatedSlides.length} Slides
            {enableSplit && promptBatches.length > 1 ? ` · ${promptBatches.length} Batches` : ''})
          </button>
        </div>

        {/* Tab 1: Script Input & Style Setup */}
        {activeTab === 'input' && (
          <div className="modal-tab-content">
            <label style={{ display: 'block', marginTop: '12px' }}>
              <strong>Paste Your Narration Script or Story:</strong>
              <textarea
                rows={7}
                className="master-prompt-textarea"
                value={scriptInput}
                onChange={(e) => setScriptInput(e.target.value)}
                placeholder="The Materialistic Woman&#10;Let's start with something many men learn the hard way.&#10;Imagine you're dating a woman who seems happy whenever you're spending money..."
              />
            </label>

            <div className="grid-2" style={{ marginTop: '14px' }}>
              <label>
                Character Consistency Style:
                <select
                  value={characterStyle}
                  onChange={(e) => setCharacterStyle(e.target.value)}
                >
                  <option value="cartoon-empath">
                    🎨 Male Empath Storybook Cartoon (Spiky Brown Hair, Brown Shirt, White BG)
                  </option>
                  <option value="cinematic">
                    🎬 Cinematic 16:9 Photorealistic
                  </option>
                </select>
              </label>

              <label>
                Breakdown Granularity:
                <select
                  value={granularity}
                  onChange={(e) => setGranularity(e.target.value)}
                >
                  <option value="comma">⚡ Bit-by-bit (Every comma &amp; clause creates a slide)</option>
                  <option value="sentence">📄 Sentence-by-sentence (One slide per full sentence)</option>
                </select>
              </label>
            </div>

            {/* Prompt Splitting Configuration Panel (Google Flow 24-image support) */}
            <div className="storyboard-split-config-box">
              <div className="storyboard-split-header">
                <label className="storyboard-split-toggle">
                  <input
                    type="checkbox"
                    checked={enableSplit}
                    onChange={(e) => setEnableSplit(e.target.checked)}
                  />
                  <span>
                    <strong>Split Image Prompts Inside Single File</strong> (e.g. Google Flow supports 24 images at a time)
                  </span>
                </label>

                <label className="storyboard-split-toggle">
                  <input
                    type="checkbox"
                    checked={firstSlideIsPoster}
                    onChange={(e) => setFirstSlideIsPoster(e.target.checked)}
                  />
                  <span>Make <code>slide 1</code> a Section Title Poster / Thumbnail</span>
                </label>
              </div>

              {enableSplit && (
                <div className="storyboard-split-controls">
                  <div className="split-control-item">
                    <span>Prompts per Split:</span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={splitSize}
                      onChange={(e) => setSplitSize(Math.max(1, Number(e.target.value) || 24))}
                      className="split-number-input"
                    />
                    <div className="split-preset-pills">
                      {[10, 12, 16, 20, 24, 30, 50].map((num) => (
                        <button
                          key={num}
                          type="button"
                          className={`split-preset-pill ${Number(splitSize) === num ? 'active' : ''}`}
                          onClick={() => setSplitSize(num)}
                        >
                          {num === 24 ? '24 (Google Flow)' : num}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="split-control-item">
                    <span>Single-File Split Divider:</span>
                    <select
                      value={splitDividerStyle}
                      onChange={(e) => setSplitDividerStyle(e.target.value)}
                    >
                      <option value="header">🏷️ Batch Header + Blank Line (=== BATCH 1 (Slides 1 - 24) ===)</option>
                      <option value="blank">📄 Blank Line Only Between Every {effectiveSplitSize} Prompts</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-actions-bar" style={{ marginTop: '18px' }}>
              <button
                type="button"
                className="primary-btn"
                disabled={!scriptInput.trim()}
                onClick={handleGenerate}
              >
                ✨ Generate Storyboard &amp; Prompts
              </button>

              <button
                type="button"
                className="ghost"
                onClick={handleCopyMotherPrompt}
                title="Copy the complete prompt template for ChatGPT, Claude, or Gemini"
              >
                📋 Copy Mother Master Prompt
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Storyboard Preview, 1-File Downloads & Batch Splits */}
        {activeTab === 'preview' && (
          <div className="modal-tab-content">
            {/* Top Row: Apply to Section + Single-File Downloads (Prompts .txt & Slide Mapping .txt) */}
            <div className="storyboard-preview-toolbar">
              <div className="flex-center-gap">
                <span>Apply to:</span>
                <select
                  value={targetSectionIdx}
                  onChange={(e) => setTargetSectionIdx(Number(e.target.value))}
                >
                  {sections.map((s, idx) => (
                    <option key={s.id} value={idx}>
                      {s.title || (idx === 0 ? 'Intro' : `Section ${idx}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary-btn small-btn"
                  onClick={handleApply}
                >
                  🚀 Apply Directly to Section
                </button>
              </div>

              <div className="storyboard-download-group">
                <button
                  type="button"
                  className="primary-btn small-btn"
                  onClick={handleDownloadAllPromptsTxt}
                  title="Download all numbered image prompts (slide 1: ..., slide 2: ...) in 1 single .txt file"
                >
                  📥 Download All Prompts (1 File .txt)
                </button>
                <button
                  type="button"
                  className="ghost small-btn"
                  onClick={handleCopyAllPrompts}
                  title="Copy all numbered image prompts to clipboard"
                >
                  📋 Copy All Prompts
                </button>
                <button
                  type="button"
                  className="primary-btn small-btn"
                  onClick={handleDownloadSlideMappingTxt}
                  title="Download Slide Mapping (Slide 1: ..., Slide 2: ...) in 1 single .txt file"
                >
                  📥 Download Slide Mapping (.txt)
                </button>
                <button
                  type="button"
                  className="ghost small-btn"
                  onClick={handleCopySlideMapping}
                  title="Copy Slide Mapping to clipboard"
                >
                  📋 Copy Mapping
                </button>
              </div>
            </div>

            {/* Live Split Controls in Preview Tab */}
            <div className="storyboard-split-bar-inline">
              <div className="flex-center-gap" style={{ flexWrap: 'wrap' }}>
                <label className="storyboard-split-toggle">
                  <input
                    type="checkbox"
                    checked={enableSplit}
                    onChange={(e) => setEnableSplit(e.target.checked)}
                  />
                  <span><strong>Split Prompts in Single File:</strong></span>
                </label>

                {enableSplit && (
                  <>
                    <label className="flex-center-gap" style={{ fontSize: '0.82rem' }}>
                      <span>Per Split:</span>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={splitSize}
                        onChange={(e) => setSplitSize(Math.max(1, Number(e.target.value) || 24))}
                        className="split-number-input"
                      />
                    </label>
                    {[12, 20, 24, 30].map((num) => (
                      <button
                        key={num}
                        type="button"
                        className={`split-preset-pill ${Number(splitSize) === num ? 'active' : ''}`}
                        onClick={() => setSplitSize(num)}
                      >
                        {num === 24 ? '24 (Google Flow)' : num}
                      </button>
                    ))}
                    <select
                      value={splitDividerStyle}
                      onChange={(e) => setSplitDividerStyle(e.target.value)}
                      style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                    >
                      <option value="header">Divider: Batch Header</option>
                      <option value="blank">Divider: Blank Line Only</option>
                    </select>
                  </>
                )}
              </div>

              <span className="badge badge-info">
                {enableSplit
                  ? `${generatedSlides.length} Prompts → ${promptBatches.length} Batch${promptBatches.length > 1 ? 'es' : ''} (${effectiveSplitSize}/split)`
                  : `${generatedSlides.length} Prompts (Un-split)`}
              </span>
            </div>

            {/* Batch Cards (shows each split batch with 1-click Copy/Download + numbered "slide 1: prompt" lines) */}
            <div className="storyboard-cards-scroll">
              {promptBatches.map((batch) => (
                <div key={batch.batchIndex} className="storyboard-batch-section">
                  <div className="storyboard-batch-header">
                    <div>
                      <span className="badge badge-info">
                        Batch {batch.batchIndex} of {promptBatches.length}
                      </span>
                      <strong style={{ marginLeft: '8px', fontSize: '0.9rem', color: '#f8fafc' }}>
                        Slides {batch.startSlide} – {batch.endSlide} ({batch.slides.length} prompts)
                      </strong>
                    </div>
                    <div className="flex-center-gap">
                      <button
                        type="button"
                        className="ghost small-btn"
                        onClick={() => handleCopyBatch(batch)}
                      >
                        📋 Copy Batch {batch.batchIndex} ({batch.startSlide}–{batch.endSlide})
                      </button>
                      <button
                        type="button"
                        className="ghost small-btn"
                        onClick={() => handleDownloadBatch(batch)}
                      >
                        📥 Download Batch {batch.batchIndex}
                      </button>
                    </div>
                  </div>

                  {batch.slides.map((s) => (
                    <div key={s.id} className="storyboard-preview-card">
                      <div className="storyboard-card-header">
                        <span className="badge badge-info">Slide {s.id}</span>
                        <span className="timecode-pill">{s.timecode}</span>
                        <span className="hook-pill">Hook: {s.hook}</span>
                      </div>
                      <div className="storyboard-sentence">
                        <code>Slide {s.id}:</code> {s.sentence}
                      </div>
                      <div className="storyboard-prompt-snippet">
                        <strong><code>slide {s.id}:</code></strong> {s.prompt}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';

const DEFAULT_CHARACTER_LOCK = `Minimalist storybook sketch illustration of the consistent male empath character with oversized round white face, messy spiky brown hair with rough irregular strokes, tiny black dot eyes, subtle eyebrows, tiny minimal mouth, thin black stick arms and legs, small simplified body, exaggerated head-to-body ratio, wearing a brown shirt and dark pants, thick rough black outlines, imperfect hand-drawn strokes, flat simple colors, pure white background, subtle soft gray ground shadow under feet, no 3D, no photorealism, no anime, no complex background`;

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
  const [targetSectionIdx, setTargetSectionIdx] = useState(activeSectionIndex);
  const [generatedSlides, setGeneratedSlides] = useState([]);
  const [activeTab, setActiveTab] = useState('input'); // 'input' | 'preview'
  const [copiedNotice, setCopiedNotice] = useState(false);

  if (!isOpen) return null;

  // Split script into granular clauses or sentences
  function parseScriptToClauses(text, mode) {
    if (!text.trim()) return [];

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
    // Return key action words
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
      const styleDesc =
        characterStyle === 'cartoon-empath'
          ? `${DEFAULT_CHARACTER_LOCK}, depicting action: ${clause}`
          : `Cinematic 16:9 widescreen photograph, dramatic lighting, detailed composition, depicting: ${clause}`;

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

  // Generate CSV string
  function buildCsvString(slides) {
    const headers = ['"Slide"', '"Timecode"', '"Sentence"', '"Concept"', '"Text Overlay"', '"Prompt"'];
    const rows = slides.map((s) => {
      const padId = String(s.id).padStart(2, '0');
      return [
        `"Slide ${padId}"`,
        `"${s.timecode}"`,
        `"${s.sentence.replace(/"/g, '""')}"`,
        `"${s.concept.replace(/"/g, '""')}"`,
        `"${s.hook.replace(/"/g, '""')}"`,
        `"${s.prompt.replace(/"/g, '""')}"`,
      ].join(',');
    });
    return [headers.join(','), ...rows].join('\n');
  }

  // Download CSV
  function handleDownloadCsv() {
    if (!generatedSlides.length) return;
    const csvContent = buildCsvString(generatedSlides);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'storyboard_prompts.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Apply directly to target section
  function handleApply() {
    if (!generatedSlides.length) return;

    const scriptText = generatedSlides.map((s) => `Slide ${s.id}: ${s.sentence}`).join('\n');
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
    const motherPrompt = `# SYSTEM & ROLE INSTRUCTION
You are an expert Storyboard Director, Prompt Engineer, and Video Production Specialist for the AI Video Maker Studio.
Your task is to take a narration script and break it down into separate Section Entities (Intro, Section 1, Section 2, etc.). For EACH section, you will generate:
1. Video Maker Script Text (restarting at Slide 1 for every section)
2. Granular Image Generation Prompts (16:9 full-screen widescreen, bottom-caption safe zone, strict Character Consistency Lock)
3. A Video Maker Production CSV Table

---
### STRICT RULES & PROJECT COMPATIBILITY INSTRUCTIONS:

1. **SEPARATE SECTION ENTITIES (RESTART AT SLIDE 1 IN EVERY SECTION)**:
   - Divide the script into its natural sections (starting with Intro, followed by Section 1, Section 2, etc.).
   - Treat every section as a completely separate entity.
   - Slide numbering MUST restart at \`Slide 1\` at the beginning of EVERY section (never continue numbering from the previous section).

2. **SECTION TITLE SLIDE & THUMBNAIL POSTER RULE**:
   - Do NOT skip the Section Title in the script: include the spoken title of each section as \`Slide 1\` of that section (except for the Intro hook, which starts directly with the first hook clause).
   - **CRITICAL EXCLUSION**: NEVER write the meta-words "Intro", "Section 1", "Section 2", or "Conclusion" inside the \`Slide X:\` spoken script text or inside the image generation prompts. Use ONLY the actual creative title words.
   - For \`Slide 1\` of every section (excluding the Intro), make the Image Prompt look like a **16:9 YouTube Thumbnail / Chapter Poster** featuring the main character alongside bold, clean hand-lettered title typography displaying ONLY that section's title text.

3. **GRANULAR ACTION BREAKDOWN (BIT-BY-BIT)**:
   - Break down the narration clause-by-clause, action-by-action, or at every natural pause/comma (,).
   - Every single slide prompt must directly depict the physical action, verb, body language, or emotion described in that exact clause (e.g., if the script says "she walked away", show her walking away into the distance while the protagonist stands looking).

4. **CHARACTER CONSISTENCY LOCK (REPEAT VERBATIM IN EVERY IMAGE PROMPT)**:
   Every generated image prompt MUST include this exact character and style description verbatim so each prompt works standalone:
   - **Character**: Male empath character with an oversized round white/off-white face, messy spiky brown hair with rough irregular strokes, tiny black dot eyes, subtle eyebrows, tiny minimal mouth, thin black stick arms and legs, small simplified body, exaggerated head-to-body ratio, primitive storybook cartoon appearance.
   - **Outfit**: Brown shirt, dark pants.
   - **Art Style**: Thick rough black outlines, imperfect hand-drawn sketch strokes, flat simple 2D colors, minimal details, clean solid pure white background, subtle light gray ground shadow under feet.
   - **Frame & Caption Safe-Zone Lock**: 16:9 widescreen full-frame composition, main character and action positioned in the center/upper 80% of the canvas, leaving the bottom 15% clean white space for animated video captions.
   - **Consistency Rule**: Keep face shape, hairstyle, proportions, clothing, and line thickness 100% IDENTICAL across all slides. Only change pose, facial expression, gestures, and essential minimalist props.
   - **Negative Constraints**: NO realistic humans, NO 3D rendering, NO photorealism, NO anime, NO complex backgrounds, NO shading gradients, NO extra clutter, NO meta-labels ("Section 1", "Intro", "Slide 1").

---
### OUTPUT FORMAT (REPEAT ALL 3 BLOCKS FOR EACH SECTION SEPARATELY):

For EACH section (Intro, Section 1, Section 2, etc.), output these 3 copy-pasteable blocks:

#### [SECTION HEADER — e.g., INTRO / SECTION 1]

**BLOCK 1: VIDEO MAKER SCRIPT TEXT (Paste into Section "Direct Text Box")**
\`\`\`text
Slide 1: [Exact spoken clause or section title — no meta-words like "Section 1" or "Intro"]
Slide 2: [Next spoken clause]
Slide 3: [Next spoken clause]
\`\`\`

**BLOCK 2: IMAGE GENERATION PROMPTS (1-to-1 Match with Slides)**
\`\`\`text
Slide 1 Prompt: [Full standalone prompt including Character Consistency Lock + specific scene action + 16:9 caption-safe framing]
Slide 2 Prompt: [Full standalone prompt including Character Consistency Lock + specific scene action + 16:9 caption-safe framing]
\`\`\`

**BLOCK 3: VIDEO MAKER PRODUCTION CSV (Upload to Section "Upload Document / CSV")**
\`\`\`csv
"Slide","Timecode","Sentence","Concept","Text Overlay","Prompt"
"Slide 01","00:00 - 00:03","[Exact spoken clause]","[Short visual summary]","[2-3 WORD PUNCHY HOOK]","[Full standalone image prompt]"
\`\`\`

---
### SCRIPT TO PROCESS:
${scriptInput || '[PASTE YOUR FULL NARRATION SCRIPT HERE]'}
`;
    navigator.clipboard.writeText(motherPrompt);
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2500);
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
              Paste your narration script to automatically generate granular slide prompts with Character Consistency Lock and Retention Hooks.
            </p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="input-mode-tabs" style={{ marginTop: '16px' }}>
          <button
            type="button"
            className={`input-mode-tab ${activeTab === 'input' ? 'active' : ''}`}
            onClick={() => setActiveTab('input')}
          >
            ✍️ Script &amp; Style Settings
          </button>
          <button
            type="button"
            className={`input-mode-tab ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
            disabled={!generatedSlides.length}
          >
            📊 Generated Storyboard ({generatedSlides.length} Slides)
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
                placeholder="Have you ever wondered what happens when an avoidant woman realizes that the person who always came back… finally stopped? She notices the silence first. It starts small. An empty phone screen."
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

            <div className="modal-actions-bar" style={{ marginTop: '20px' }}>
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
                title="Copy the complete prompt template for ChatGPT or Claude"
              >
                {copiedNotice ? '✓ Copied to Clipboard!' : '📋 Copy Mother Master Prompt'}
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Storyboard Preview & 1-Click Apply */}
        {activeTab === 'preview' && (
          <div className="modal-tab-content">
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

              <button
                type="button"
                className="ghost small-btn"
                onClick={handleDownloadCsv}
              >
                💾 Export CSV File
              </button>
            </div>

            <div className="storyboard-cards-scroll">
              {generatedSlides.map((s) => (
                <div key={s.id} className="storyboard-preview-card">
                  <div className="storyboard-card-header">
                    <span className="badge badge-info">Slide #{s.id}</span>
                    <span className="timecode-pill">{s.timecode}</span>
                    <span className="hook-pill">Hook: {s.hook}</span>
                  </div>
                  <div className="storyboard-sentence">&ldquo;{s.sentence}&rdquo;</div>
                  <div className="storyboard-prompt-snippet">
                    <strong>Prompt:</strong> {s.prompt}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

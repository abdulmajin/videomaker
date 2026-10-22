# AI Slide Video Maker (v1.0)

An automated browser-based slide timing, animation, and video rendering studio built with **React 18** and **Vite**.

It synchronizes slide images and scripts with a recorded voiceover using OpenAI Whisper directly inside the browser (via Web Workers and WebAssembly), animates slides with Canva-style motions, and exports full HD video (`.mp4` / `.webm`) and subtitle files (`.srt`, `.vtt`, `.json`).

---

## ✨ Features

- 🎨 **Google AI Image Generation (Google Flow / Imagen 3)**:
  - Generates photorealistic 16:9 widescreen images directly from slide script prompts line-by-line.
  - Powered by Google's official **Imagen 3** (`imagen-3.0-generate-002`) and includes an instant free engine option.
  - Automatically waits, downloads, and maps generated images to the corresponding voiceover timestamps.
  - One-click prompt enhancement with visual style presets (Cinematic, Documentary, Digital Art, Anime, 3D Render).

- 🎙️ **In-Browser Speech Recognition**:
  - Transcribes audio locally using Whisper models (`Xenova/whisper-tiny.en`, `Xenova/whisper-base.en`) via `@huggingface/transformers`.
  - Runs in a background Web Worker with word-level timestamps without needing external API keys.

- 📄 **Multi-Format Script Ingestion**:
  - Accepts `.docx` (via `mammoth`), `.pdf` (via `pdfjs-dist`), and `.txt` scripts.
  - Automatically parses slides formatted as `Slide 1: ...`, `Slide 2: ...`.

- ⚡ **Automated Speech-to-Script Alignment**:
  - Uses Longest Common Subsequence (LCS) dynamic programming to find exact timestamps for each slide.
  - Displays confidence match percentages and allows manual timing adjustments.

- 🎨 **Canva-Style Slide Animations**:
  - Dynamic motion for every slide: Ken Burns Zoom In, Zoom Out, Pop & Bounce, Breathe, Slide Left/Right/Up, Pan & Drift, and Smooth Crossfade.
  - Mixes animations randomly or lets you customize the animation style for each individual slide.

- ⏱️ **Interactive Visual Timeline**:
  - Multi-slide track showing slide duration proportions, thumbnails, and numbers.
  - Real-time scrubbing playhead needle with click-to-seek functionality.

- 💬 **Customizable Captions**:
  - Social Pop (TikTok / Reels bold yellow style)
  - Modern Card (Frosted pill with slide badge)
  - Classic Cinema (Clean subtitles with drop-shadow)
  - Top Banner
  - None (Clean video without subtitles)

- 🎬 **Video & Data Export**:
  - In-browser video rendering (720p / 1080p Full HD) into `.mp4` or `.webm` using HTML5 Canvas, Web Audio API, and `MediaRecorder`.
  - Subtitle exports: `.srt` and `.vtt`.
  - Structured timeline export: `.json`.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)

### Installation

1. Clone this repository:
   ```bash
   git clone <YOUR_REPOSITORY_URL>
   cd video-maker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:5173/`.

### Building for Production

```bash
npm run build
```
The compiled files will be located in the `dist/` directory.

---

## 🛠️ Tech Stack

- **Framework**: React 18
- **Build Tool**: Vite 5
- **AI / Speech-to-Text**: `@huggingface/transformers` (ONNX Runtime WebAssembly)
- **Document Parsing**: `pdfjs-dist`, `mammoth`
- **Video & Audio**: HTML5 Canvas, Web Audio API, MediaRecorder API
- **Styling**: Vanilla CSS (Dark Studio Theme)

---

## 📄 License
MIT

// AI Image Generation Service (Google Flow / Imagen 3 + Free Fast AI)

export const IMAGE_STYLES = [
  { id: 'cinematic', label: '🎬 Cinematic Photorealistic (Default)' },
  { id: 'documentary', label: '📸 National Geographic Documentary' },
  { id: 'digital-art', label: '🎨 Modern Digital Art & Concept' },
  { id: 'anime', label: '🎌 Studio Anime & Vibrant Scenery' },
  { id: '3d-render', label: '🧸 3D Animation (Pixar Style)' },
  { id: 'minimalist', label: '📐 Clean Flat Vector Illustration' },
];

export const IMAGE_ENGINES = [
  {
    id: 'google-imagen',
    label: '✨ Google Imagen 3 (Google Flow Engine - API Key required)',
    requiresKey: true,
  },
  {
    id: 'free-instant',
    label: '⚡ Instant Free AI (No API Key Required)',
    requiresKey: false,
  },
];

// Automatically crafts a visual prompt from script text
export function enhancePrompt(scriptText, style = 'cinematic') {
  if (!scriptText) return 'A beautiful scenic landscape, 16:9 cinematic shot';

  // Strip slide labels like "Slide 1:"
  const clean = scriptText
    .replace(/^slide\s*\d+\s*[:\-\.]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const stylePrompts = {
    cinematic: 'cinematic 16:9 widescreen photograph, dramatic lighting, detailed composition, 8k resolution, photorealistic, professional color grading',
    documentary: 'editorial documentary photograph, natural sunlight, hyper-realistic, highly detailed textures, 16:9',
    'digital-art': 'vibrant digital art, detailed concept art, 16:9 widescreen, atmospheric perspective, trending on Artstation',
    anime: 'high-quality modern anime scenery, Makoto Shinkai style, vibrant colors, beautiful lighting, 16:9 widescreen',
    '3d-render': '3D render, Pixar and Disney animated movie style, smooth textures, warm lighting, octane render, 16:9',
    minimalist: 'clean minimalist vector graphic, modern editorial flat art, bold colors, 16:9 widescreen',
  };

  const suffix = stylePrompts[style] || stylePrompts.cinematic;
  return `${clean}, ${suffix}`;
}

/**
 * Verifies a Google AI Studio API key by listing available models.
 * Returns { valid: boolean, message: string, models?: string[] }
 */

export async function verifyGoogleApiKey(apiKey) {
  if (!apiKey?.trim()) {
    return { valid: false, message: 'API key is empty.' };
  }

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models',
      {
        headers: {
          'x-goog-api-key': apiKey.trim(),
        },
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        valid: false,
        message:
          data?.error?.message ||
          `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return {
      valid: true,
      message:
        'API key accepted for model listing. Image generation access has not been tested.',
      models: (data.models || []).map((model) => model.name),
    };
  } catch (error) {
    return {
      valid: false,
      message: `Network error: ${error.message}`,
    };
  }
}

/**
 * Generates an image using Google's official Imagen 3 via the
 * OpenAI-compatible images/generations endpoint (most reliable for
 * Google AI Studio API keys).
 *
 * Falls back to the native :predict endpoint if the OpenAI-compat
 * endpoint fails.
 */

/**
 * Generate an image using Google's Gemini image-generation API.
 * Replaces the retired Imagen 3 endpoints.
 */
export async function generateGoogleImagen({
  prompt,
  apiKey,
  aspectRatio = '16:9',
}) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error(
      'Google AI API key is missing. Enter your API key or switch to Instant Free AI.'
    );
  }

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/interactions',
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gemini-nano-banana-2.1',
        input: prompt,
        response_format: {
          type: 'image',
          aspect_ratio: aspectRatio,
          mime_type: 'image/jpeg',
          image_size: '1K',
        },
      }),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ||
      `HTTP ${response.status}: ${response.statusText}`;

    throw new Error(`Google Gemini image generation failed: ${message}`);
  }

  // Support the convenience output_image shape and REST step output.
  let imageData = data?.output_image?.data;
let mimeType = data?.output_image?.mime_type || 'image/jpeg';
  if (!imageData && Array.isArray(data?.steps)) {
    for (const step of data.steps) {
      if (step.type !== 'model_output') continue;

      const imageBlock = (step.content || [])
        .find((item) => item.type === 'image' && item.data);

      if (imageBlock) {
        imageData = imageBlock.data;
        mimeType = imageBlock.mime_type || 'image/png';
      }
    }
  }

  if (!imageData) {
    throw new Error(
      'Google returned a response but no image data was found. ' +
      'Check the API response structure and image-generation access.'
    );
  }

  // Decode Base64 into a browser Blob.
  const binary = atob(imageData);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: mimeType });

  return {
    blob,
    prompt,
    engine: 'google-imagen',
  };
}


// OpenAI-compatible endpoint: POST /v1beta/openai/images/generations
async function _tryOpenAICompatEndpoint(prompt, apiKey, aspectRatio) {
  // Map aspect ratio to size string
  const sizeMap = {
    '16:9': '1536x1024',
    '9:16': '1024x1536',
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
  };
  const size = sizeMap[aspectRatio] || '1536x1024';

  const url = 'https://generativelanguage.googleapis.com/v1beta/openai/images/generations';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'imagen-3.0-generate-002',
      prompt,
      n: 1,
      response_format: 'b64_json',
      size,
    }),
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    const message = errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(message);
  }

  const data = await response.json();
  const imageData = data?.data?.[0];

  if (!imageData?.b64_json) {
    throw new Error('No image data returned from OpenAI-compat endpoint.');
  }

  // Convert Base64 to Blob
  const base64Data = imageData.b64_json;
  const mimeType = 'image/png';
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  return { blob, prompt, engine: 'google-imagen' };
}

// Native Vertex-style :predict endpoint with x-goog-api-key header
async function _tryNativePredictEndpoint(prompt, apiKey, aspectRatio) {
  const models = ['imagen-3.0-generate-002', 'imagen-3.0-generate-001'];

  for (const modelName of models) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio,
            outputMimeType: 'image/jpeg',
          },
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        const msg = errorJson?.error?.message || `HTTP ${response.status}`;
        console.warn(`[Imagen] Model ${modelName} failed:`, msg);
        continue; // Try next model
      }

      const data = await response.json();
      const prediction = data?.predictions?.[0];

      if (!prediction?.bytesBase64Encoded) {
        continue; // Try next model
      }

      // Convert Base64 to Blob
      const base64Data = prediction.bytesBase64Encoded;
      const mimeType = prediction.mimeType || 'image/jpeg';
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });

      return { blob, prompt, engine: 'google-imagen' };
    } catch (e) {
      console.warn(`[Imagen] Model ${modelName} error:`, e.message);
      continue;
    }
  }

  return null; // All models failed
}

// Generates an image using fast free cloud generation (no API key required)
export async function generateFreeAI({ prompt, width = 1280, height = 720 }) {
  const seed = Math.floor(Math.random() * 10000000);
  const cleanPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Free AI image generation failed (${response.status})`);
  }

  const blob = await response.blob();
  return {
    blob,
    prompt,
    engine: 'free-instant',
  };
}

// Main dispatcher to generate an image
export async function generateSlideImage({
  prompt,
  apiKey = '',
  engine = 'google-imagen',
  style = 'cinematic',
}) {
  const finalPrompt = prompt.includes('16:9') ? prompt : enhancePrompt(prompt, style);

  if (engine === 'google-imagen') {
    return generateGoogleImagen({ prompt: finalPrompt, apiKey, aspectRatio: '16:9' });
  } else {
    return generateFreeAI({ prompt: finalPrompt, width: 1280, height: 720 });
  }
}

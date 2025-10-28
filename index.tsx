/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {GoogleGenAI, Type} from '@google/genai';

// Fix: Define and use AIStudio interface for window.aistudio to resolve type conflict.
// Define the aistudio property on the window object for TypeScript
declare global {
  interface AIStudio {
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

async function openApiKeyDialog() {
  if (window.aistudio?.openSelectKey) {
    await window.aistudio.openSelectKey();
  } else {
    // This provides a fallback for environments where the dialog isn't available
    showStatusError(
      'API key selection is not available. Please configure the API_KEY environment variable.',
    );
  }
}

const statusEl = document.querySelector('#status') as HTMLDivElement;
const progressIndicator = document.querySelector(
  '#progress-indicator',
) as HTMLDivElement;
const progressBar = document.querySelector('#progress-bar') as HTMLDivElement;
const step1 = document.querySelector('#step-1') as HTMLDivElement;
const step2 = document.querySelector('#step-2') as HTMLDivElement;
const step3 = document.querySelector('#step-3') as HTMLDivElement;
const steps = [step1, step2, step3];

async function generateImage(
  prompt: string,
  negativePrompt: string,
  signature: string,
  apiKey: string,
) {
  const ai = new GoogleGenAI({apiKey});

  const config: {negativePrompt?: string} = {};
  if (negativePrompt && negativePrompt.trim() !== '') {
    config.negativePrompt = negativePrompt;
  }

  let finalPrompt = prompt;
  if (signature && signature.trim() !== '') {
    finalPrompt += `\n\nSignature Instructions:
      - Text: "${signature}"
      - Style: A prominent, stamped effect, like a vintage seal or an artist's chop mark. It should be clear but artistically integrated.
      - Placement: Aesthetically placed on the artwork, for example around the shoulder area of a subject or subtly integrated into the composition. It must NOT be placed at the very bottom or in a standard corner like the bottom-right.`;
  }

  const response = await ai.models.generateImages({
    model: 'imagen-4.0-generate-001',
    prompt: finalPrompt,
    config,
  });

  const images = response.generatedImages;
  if (images === undefined || images.length === 0) {
    throw new Error(
      'No images were generated. The prompt may have been blocked.',
    );
  }

  const base64ImageBytes = images[0].image.imageBytes;
  const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
  outputImage.src = imageUrl;
  outputImage.style.display = 'block';
  outputPlaceholder.style.display = 'none';
  downloadButton.style.display = 'block';
}

async function editImage(
  prompt: string,
  negativePrompt: string,
  signature: string,
  image: {base64Data: string; mimeType: string},
  apiKey: string,
) {
  const ai = new GoogleGenAI({apiKey});

  const imagePart = {
    inlineData: {
      data: image.base64Data,
      mimeType: image.mimeType,
    },
  };

  const instruction =
    'This is an image editing task. Apply the artistic style from the following text prompt to the provided image. It is crucial that you do not change the underlying subject or composition of the image, only alter its style.';
  let combinedPrompt = `${instruction}\n\nStyle Prompt: "${prompt}"`;
  if (negativePrompt && negativePrompt.trim() !== '') {
    combinedPrompt += `\n\nExclude these elements: "${negativePrompt}"`;
  }
  if (signature && signature.trim() !== '') {
    combinedPrompt += `\n\nSignature Instructions:
      - Text: "${signature}"
      - Style: A prominent, stamped effect, like a vintage seal or an artist's chop mark. It should be clear but artistically integrated.
      - Placement: Aesthetically placed on the artwork, for example around the shoulder area of a subject or subtly integrated into the composition. It must NOT be placed at the very bottom or in a standard corner like the bottom-right.`;
  }
  const textPart = {text: combinedPrompt};

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {parts: [imagePart, textPart]},
    config: {
      responseModalities: ['IMAGE'],
    },
  });

  let base64ImageBytes: string | undefined;
  if (response.candidates && response.candidates.length > 0) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        base64ImageBytes = part.inlineData.data;
        break; // Found the image data
      }
    }
  }

  if (!base64ImageBytes) {
    throw new Error(
      'No image was generated. The prompt may have been blocked or the model failed to produce an image.',
    );
  }

  const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
  outputImage.src = imageUrl;
  outputImage.style.display = 'block';
  outputPlaceholder.style.display = 'none';
  downloadButton.style.display = 'block';
}

async function generatePromptFromImage(
  base64Data: string,
  mimeType: string,
  apiKey: string,
) {
  showProgress('Analyzing image...', 2);
  try {
    const ai = new GoogleGenAI({apiKey});

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: mimeType,
      },
    };

    const textPart = {
      text: 'Describe this image in extreme detail for a text-to-image model. Capture the mood, style, composition, colors, lighting, and any specific artistic characteristics. Be very descriptive and evocative, as if writing a prompt for an AI art generator.',
    };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {parts: [textPart, imagePart]},
    });

    const newPrompt = response.text;
    prompt = newPrompt; // update state variable
    promptEl.value = newPrompt;
    hideProgress('Prompt generated from image. You can edit it below.');
  } catch (e) {
    console.error('Prompt generation from image failed:', e);
    const errorMessage =
      e instanceof Error ? e.message : 'An unknown error occurred.';
    showStatusError(`Error generating prompt: ${errorMessage}`);
    // Clear thumbnail on error
    thumbnailEl.src = '';
    thumbnailEl.style.display = 'none';
  }
}

async function getPromptAssistance(
  currentPrompt: string,
  currentNegativePrompt: string,
  image: {base64Data: string; mimeType: string} | null,
  apiKey: string,
) {
  showProgress('Assistant is thinking...', 2);
  try {
    const ai = new GoogleGenAI({apiKey});

    const hasImage = image !== null;
    const systemInstruction = `You are a prompt engineering assistant for an advanced text-to-image model. Your task is to take a user's prompt and negative prompt and enhance them.
    ${
      hasImage
        ? 'The user has provided a reference image. Base your suggestions on the content and style of this image.'
        : ''
    }
    - Expand on the user's ideas, adding rich detail, suggesting artistic styles, camera angles, lighting, and composition.
    - For the negative prompt, add common terms to avoid bad practices like blurriness, extra limbs, or text.
    - Return a JSON object with two keys: "revisedPrompt" and "revisedNegativePrompt".
    - If a prompt is empty, create a creative one ${
      hasImage ? 'based on the image' : ''
    }. If a negative prompt is empty, create a standard, robust one.`;

    const textContent = `Here is the user's current input:
    Prompt: "${currentPrompt}"
    Negative Prompt: "${currentNegativePrompt}"
    
    Please revise and enhance them according to your instructions.`;

    let contents: any;
    if (hasImage) {
      contents = {
        parts: [
          {text: textContent},
          {
            inlineData: {
              data: image.base64Data,
              mimeType: image.mimeType,
            },
          },
        ],
      };
    } else {
      contents = textContent;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            revisedPrompt: {
              type: Type.STRING,
              description: 'The enhanced, detailed, and artistic prompt.',
            },
            revisedNegativePrompt: {
              type: Type.STRING,
              description:
                'The enhanced negative prompt to avoid unwanted elements.',
            },
          },
          required: ['revisedPrompt', 'revisedNegativePrompt'],
        },
      },
    });

    const jsonText = response.text.trim();
    const result = JSON.parse(jsonText);

    prompt = result.revisedPrompt;
    negativePrompt = result.revisedNegativePrompt;
    promptEl.value = prompt;
    negativePromptEl.value = negativePrompt;
    hideProgress('Prompt enhanced by Assistant!');
  } catch (e) {
    console.error('Prompt assistance failed:', e);
    const errorMessage =
      e instanceof Error ? e.message : 'An unknown error occurred.';
    showStatusError(`Error from assistant: ${errorMessage}`);
  }
}

// --- DOM Element Selection ---
const promptEl = document.querySelector('#prompt-input') as HTMLTextAreaElement;
const negativePromptEl = document.querySelector(
  '#negative-prompt-input',
) as HTMLTextAreaElement;
const signatureEl = document.querySelector(
  '#signature-input',
) as HTMLInputElement;
const generateButton = document.querySelector(
  '#generate-button',
) as HTMLButtonElement;
const assistantButton = document.querySelector(
  '#assistant-button',
) as HTMLButtonElement;
const outputImage = document.querySelector('#output-image') as HTMLImageElement;
const outputPlaceholder = document.querySelector(
  '#output-placeholder',
) as HTMLSpanElement;
const downloadButton = document.querySelector(
  '#download-button',
) as HTMLButtonElement;
const uploadInput = document.querySelector('#upload-input') as HTMLInputElement;
const thumbnailEl = document.querySelector(
  '#uploaded-image-thumbnail',
) as HTMLImageElement;
const uploadInputApply = document.querySelector(
  '#upload-input-apply',
) as HTMLInputElement;
const thumbnailApplyEl = document.querySelector(
  '#uploaded-image-apply-thumbnail',
) as HTMLImageElement;
const previewModal = document.querySelector('#preview-modal') as HTMLDivElement;
const previewImage = document.querySelector(
  '#preview-image',
) as HTMLImageElement;
const closeModalButton = document.querySelector(
  '#close-modal',
) as HTMLButtonElement;

// --- State Variables ---
let prompt = `A close-up portrait of a young woman with dark hair pulled up into a messy bun, wearing square-shaped black-framed eyeglasses, a red collared shirt, and a dark apron with brown straps. She looks directly at the viewer with a serious expression. The entire scene is rendered in a high-contrast, graphic illustration style reminiscent of pop art or stylized vector graphics, using a strict duotone color palette of vibrant, warm orange, and solid black. Dramatic, directional lighting casts deep, hard-edged shadows that obscure large portions of her face and body, emphasizing silhouette and form. The focus is sharp, characterized by precise black lines, creating a moody, minimalist, and intensely stylized visual impact. The background is a blurred cafe setting featuring a brick wall texture and faint shelving details, also rendered in the orange and black duotone.`;
promptEl.value = prompt;
let negativePrompt = '';
let signature = '';
let referenceImage: {base64Data: string; mimeType: string} | null = null;
let applyImage: {base64Data: string; mimeType: string} | null = null;

// --- Event Listeners ---
promptEl.addEventListener('input', () => {
  prompt = promptEl.value;
});

negativePromptEl.addEventListener('input', () => {
  negativePrompt = negativePromptEl.value;
});

signatureEl.addEventListener('input', () => {
  signature = signatureEl.value;
});

generateButton.addEventListener('click', () => {
  if (!prompt.trim()) {
    showStatusError('Please enter a prompt to generate an image.');
    return;
  }
  generate();
});

assistantButton.addEventListener('click', async () => {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    showStatusError('API key is not configured. Please add your API key.');
    await openApiKeyDialog();
    return;
  }
  await getPromptAssistance(prompt, negativePrompt, referenceImage, apiKey);
});

downloadButton.addEventListener('click', () => {
  if (!outputImage.src) return;
  const link = document.createElement('a');
  link.href = outputImage.src;
  link.download = 'generated-image.jpeg';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

uploadInput.addEventListener('change', async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  // Reset other state
  applyImage = null;
  thumbnailApplyEl.style.display = 'none';
  thumbnailApplyEl.src = '';
  outputImage.style.display = 'none';
  outputImage.src = '';
  if (outputPlaceholder) outputPlaceholder.style.display = 'block';
  downloadButton.style.display = 'none';

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    showStatusError(
      'API key is not configured. Please add your API key to upload an image.',
    );
    await openApiKeyDialog();
    // Reset the file input so user can try again
    target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onloadend = async () => {
    const base64Data = (reader.result as string).split(',')[1];
    const mimeType = file.type;

    referenceImage = {base64Data, mimeType};

    // Show thumbnail
    thumbnailEl.src = reader.result as string;
    thumbnailEl.style.display = 'block';

    // Generate prompt
    await generatePromptFromImage(base64Data, mimeType, apiKey);
  };
  reader.readAsDataURL(file);
});

uploadInputApply.addEventListener('change', async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  // Reset other state
  referenceImage = null;
  thumbnailEl.style.display = 'none';
  thumbnailEl.src = '';
  outputImage.style.display = 'none';
  outputImage.src = '';
  if (outputPlaceholder) outputPlaceholder.style.display = 'block';
  downloadButton.style.display = 'none';
  statusEl.innerText = 'Photo to apply prompt to has been selected.';

  const reader = new FileReader();
  reader.onloadend = async () => {
    const base64Data = (reader.result as string).split(',')[1];
    const mimeType = file.type;

    applyImage = {base64Data, mimeType};

    // Show thumbnail
    thumbnailApplyEl.src = reader.result as string;
    thumbnailApplyEl.style.display = 'block';
  };
  reader.readAsDataURL(file);
});

outputImage.addEventListener('click', () => {
  if (outputImage.src && !outputImage.src.endsWith('#')) {
    // Check if there is a valid image
    previewImage.src = outputImage.src;
    previewModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
  }
});

function hideModal() {
  previewModal.classList.add('hidden');
  document.body.style.overflow = ''; // Restore scrolling
}

closeModalButton.addEventListener('click', hideModal);

previewModal.addEventListener('click', (event) => {
  // Close modal if the click is on the backdrop (the modal itself) and not its children
  if (event.target === previewModal) {
    hideModal();
  }
});

// Also listen for Escape key to close the modal for better accessibility
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !previewModal.classList.contains('hidden')) {
    hideModal();
  }
});

// --- Functions ---
function updateProgress(step: number, message: string) {
  statusEl.innerText = message;
  const progressWidths = ['10%', '50%', '100%'];
  progressBar.style.width = progressWidths[step - 1] || '10%';

  steps.forEach((stepEl, index) => {
    const stepCircle = stepEl.querySelector('.step-circle') as HTMLDivElement;
    stepEl.classList.remove('active', 'complete');

    // Restore original number
    stepCircle.innerHTML = `${index + 1}`;

    if (index < step - 1) {
      stepEl.classList.add('complete');
      stepCircle.innerHTML = '✓'; // Add checkmark
    } else if (index === step - 1) {
      stepEl.classList.add('active');
    }
  });

  const step1El = steps[0];
  if (step1El.classList.contains('complete')) {
    (step1El.nextElementSibling as HTMLElement)?.classList.add('bg-green-600');
  }
}

function showProgress(message: string, step: number = 1) {
  progressIndicator.classList.remove('hidden');
  progressIndicator.classList.add('flex');
  updateProgress(step, message);
  setControlsDisabled(true);
}

function hideProgress(message = '') {
  statusEl.innerText = message;
  progressIndicator.classList.add('hidden');
  progressIndicator.classList.remove('flex');
  setControlsDisabled(false);
}

function showStatusError(message: string) {
  statusEl.innerHTML = `<span class="text-red-400">${message}</span>`;
  progressIndicator.classList.add('hidden');
  progressIndicator.classList.remove('flex');
  setControlsDisabled(false);
}

function setControlsDisabled(disabled: boolean) {
  generateButton.disabled = disabled;
  assistantButton.disabled = disabled;
  promptEl.disabled = disabled;
  negativePromptEl.disabled = disabled;
  signatureEl.disabled = disabled;
  uploadInput.disabled = disabled;
  uploadInputApply.disabled = disabled;
}

async function generate() {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    showStatusError('API key is not configured. Please add your API key.');
    await openApiKeyDialog();
    return;
  }

  showProgress('Preparing request...', 1);
  outputImage.style.display = 'none';
  if (outputPlaceholder) outputPlaceholder.style.display = 'block';
  downloadButton.style.display = 'none';

  // Allow UI to update
  await new Promise((resolve) => setTimeout(resolve, 200));

  try {
    updateProgress(2, applyImage ? 'Applying style...' : 'Generating image...');
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (applyImage) {
      await editImage(prompt, negativePrompt, signature, applyImage, apiKey);
    } else {
      await generateImage(prompt, negativePrompt, signature, apiKey);
    }

    updateProgress(3, 'Finalizing...');
    await new Promise((resolve) => setTimeout(resolve, 500));

    hideProgress('Image generated successfully.');
  } catch (e) {
    console.error('Image generation failed:', e);
    const errorMessage =
      e instanceof Error ? e.message : 'An unknown error occurred.';

    let userFriendlyMessage = `Error: ${errorMessage}`;
    let shouldOpenDialog = false;

    if (typeof errorMessage === 'string') {
      if (errorMessage.includes('Requested entity was not found.')) {
        userFriendlyMessage =
          'Model not found. This can be caused by an invalid API key or permission issues. Please check your API key.';
        shouldOpenDialog = true;
      } else if (
        errorMessage.includes('API_KEY_INVALID') ||
        errorMessage.includes('API key not valid') ||
        errorMessage.toLowerCase().includes('permission denied')
      ) {
        userFriendlyMessage =
          'Your API key is invalid. Please add a valid API key.';
        shouldOpenDialog = true;
      }
    }

    showStatusError(userFriendlyMessage);

    if (shouldOpenDialog) {
      await openApiKeyDialog();
    }
  }
}
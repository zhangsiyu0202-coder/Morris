// GoogleGenAI client factory pointed at a configurable base URL.
//
// Mirrors PostHog's a2_upload_video_to_gemini.py: instantiate the SDK with
// raw credentials. The apiKey is an opaque string from the caller; this
// module does not interpret it. Auth between the function and any reverse
// proxy is a deployment concern, not an analyzer concern.

export interface GeminiClientConfig {
  /** Base URL for the Gemini API. Default Google direct: https://generativelanguage.googleapis.com/. */
  baseUrl?: string;
  /** API key. Passed through to the SDK as-is. */
  apiKey: string;
}

export type GeminiClient = {
  files: {
    upload(args: {
      file: string | Blob;
      config?: { mimeType?: string; displayName?: string };
    }): Promise<unknown>;
    get(args: { name: string }): Promise<unknown>;
    delete(args: { name: string }): Promise<unknown>;
  };
  models: {
    generateContent(args: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }): Promise<{ text?: string; candidates?: unknown }>;
  };
};

/**
 * Lazy-imports @google/genai so consumers that never call this don't need it.
 */
export async function createGeminiClient(config: GeminiClientConfig): Promise<GeminiClient> {
  const { baseUrl, apiKey } = config;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");

  const mod = await import("@google/genai");
  const GoogleGenAI = (mod as { GoogleGenAI: new (init: unknown) => GeminiClient }).GoogleGenAI;
  return new GoogleGenAI({
    apiKey,
    ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
  });
}

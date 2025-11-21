/**
 * Shared session management logic for ephemeral keys and tools
 */

import { CLIENT_CONFIG as CONFIG } from '@/lib/constants';

// Cached tools to avoid repeated fetches
let cachedTools: any[] | null = null;
let cachedToolChoice: string = "auto";

export interface SessionCredentials {
  sessionId: string;
  ephemeralKey: string;
  realtimeUrl: string;
  voice: string;
  model: string;
}

export interface ToolsData {
  tools: any[];
  toolChoice: string;
}

/**
 * Load tool definitions from backend (cached)
 */
export async function ensureToolsLoaded(): Promise<ToolsData> {
  if (cachedTools !== null) {
    return {
      tools: cachedTools,
      toolChoice: cachedToolChoice,
    };
  }

  const response = await fetch(`${CONFIG.backendBaseUrl}/tools`);
  if (!response.ok) {
    throw new Error(`Unable to retrieve tool definitions (${response.status})`);
  }

  const data = await response.json();
  cachedTools = data.tools ?? [];
  cachedToolChoice = data.tool_choice ?? "auto";

  console.log('[SessionManager]', `Loaded ${cachedTools?.length || 0} tool definition(s)`);
  console.log('[SessionManager]', `Tools: ${cachedTools?.map(t => t.name).join(', ') || 'none'}`);

  return {
    tools: cachedTools || [],
    toolChoice: cachedToolChoice,
  };
}

/**
 * Request ephemeral session credentials from backend
 * Used by WebRTC and Voice Live modes
 */
export async function requestSessionCredentials(
  connectionMode: 'webrtc' | 'voice-live' = 'webrtc',
  voice?: string,
  model?: string
): Promise<SessionCredentials> {

  console.log('[SessionManager]', `Requesting session credentials for mode: ${connectionMode}, voice: ${voice}, model: ${model}`);
  console.log('[SessionManager]', `Default entity values: voice=${CONFIG.voice}, model=${CONFIG.deployment}`);

  const response = await fetch(`${CONFIG.backendBaseUrl}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deployment: model || CONFIG.deployment,
      voice: voice || CONFIG.voice,
      connection_mode: connectionMode,
    }),
  });

  console.log('[SessionManager]', `Request payload: ${JSON.stringify({
    deployment: model || CONFIG.deployment,
    voice: voice || CONFIG.voice,
    connection_mode: connectionMode,
  })}`);

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Session request failed: ${details}`);
  }

  const payload = await response.json();
  console.log('[SessionManager]', `Received session ID: ${payload.session_id}`);
  console.log('[SessionManager]', `Ephemeral key: ${payload.ephemeral_key}`);
  console.log('[SessionManager]', `Realtime URL: ${payload.realtimeUrl}`);

  const finalVoice = voice || CONFIG.voice;
  const finalModel = model || CONFIG.deployment;

  return {
    sessionId: payload.session_id,
    ephemeralKey: payload.ephemeral_key,
    realtimeUrl: payload.realtimeUrl,
    voice: finalVoice,
    model: finalModel,
  };
}

/**
 * Clear cached tools (for testing/refresh)
 */
export function clearToolsCache(): void {
  cachedTools = null;
  cachedToolChoice = "auto";
}

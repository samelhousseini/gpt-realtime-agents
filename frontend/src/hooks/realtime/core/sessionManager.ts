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
 * Used by WebRTC and WebSocket Direct modes
 */
export async function requestSessionCredentials(): Promise<SessionCredentials> {
  const response = await fetch(`${CONFIG.backendBaseUrl}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deployment: CONFIG.deployment,
      voice: CONFIG.voice,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Session request failed: ${details}`);
  }

  const payload = await response.json();
  return {
    sessionId: payload.session_id,
    ephemeralKey: payload.ephemeral_key,
    realtimeUrl: payload.realtimeUrl,
  };
}

/**
 * Clear cached tools (for testing/refresh)
 */
export function clearToolsCache(): void {
  cachedTools = null;
  cachedToolChoice = "auto";
}

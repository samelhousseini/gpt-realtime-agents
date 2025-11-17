export type MessageRole = 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'human_agent' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: any;
  toolResult?: any;
  audioUrl?: string;
}

export interface SuggestionCard {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  prompt: string;
  toolName?: string;
}

export interface SessionState {
  status: 'idle' | 'connecting' | 'connected' | 'ended';
  isMuted: boolean;
  connectionMode?: 'webrtc' | 'voice-live';
}

export interface EscalationState {
  status: 'available' | 'queued' | 'connected';
  queuePosition?: number;
}

export interface CustomerProfile {
  name: string;
  accountId: string;
  plan: string;
  balance: number;
  isVerified: boolean;
}

export interface RecentAction {
  id: string;
  timestamp: number;
  action: string;
  details: string;
  canUndo?: boolean;
}
/**
 * Abstract base class for all Realtime connection modes
 */

import { ChatMessage } from '@/lib/types';
import { getUserMediaStream, stopMediaStream } from './audioUtils';
import { ensureToolsLoaded, ToolsData } from './sessionManager';

export interface SessionState {
  status: 'idle' | 'connecting' | 'connected' | 'ended';
  isMuted: boolean;
}

export interface RealtimeSessionConfig {
  onMessage: (message: ChatMessage) => void;
  onStateChange: (state: Partial<SessionState>) => void;
}

/**
 * Base class for all connection implementations
 */
export abstract class RealtimeSessionBase {
  // Shared state
  protected sessionState: SessionState = {
    status: 'idle',
    isMuted: false,
  };

  // Shared resources
  protected clientMedia: MediaStream | null = null;
  protected toolsData: ToolsData | null = null;

  // Callbacks
  protected onMessage: (message: ChatMessage) => void;
  protected onStateChange: (state: Partial<SessionState>) => void;

  constructor(config: RealtimeSessionConfig) {
    this.onMessage = config.onMessage;
    this.onStateChange = config.onStateChange;
  }

  /**
   * Update session state and notify listeners
   */
  protected updateState(updates: Partial<SessionState>): void {
    this.sessionState = { ...this.sessionState, ...updates };
    this.onStateChange(updates);
  }

  /**
   * Log message with prefix
   */
  protected log(message: string): void {
    console.log(`[${this.constructor.name}]`, message);
  }

  /**
   * Start audio capture from microphone
   */
  protected async startAudioCapture(): Promise<void> {
    this.log('Starting audio capture...');
    this.clientMedia = await getUserMediaStream();
    this.log('Audio capture started');
  }

  /**
   * Stop audio capture
   */
  protected stopAudioCapture(): void {
    stopMediaStream(this.clientMedia);
    this.clientMedia = null;
    this.log('Audio capture stopped');
  }

  /**
   * Load tools from backend
   */
  protected async loadTools(): Promise<void> {
    this.toolsData = await ensureToolsLoaded();
  }

  /**
   * Toggle mute state
   */
  public toggleMute(): void {
    if (!this.clientMedia) return;

    const audioTrack = this.clientMedia.getAudioTracks()[0];
    if (!audioTrack) return;

    audioTrack.enabled = !audioTrack.enabled;
    this.updateState({ isMuted: !audioTrack.enabled });
    this.log(`Microphone ${audioTrack.enabled ? 'unmuted' : 'muted'}`);
  }

  /**
   * Get current media stream
   */
  public getMediaStream(): MediaStream | null {
    return this.clientMedia;
  }

  /**
   * Get current session state
   */
  public getSessionState(): SessionState {
    return this.sessionState;
  }

  // Abstract methods to be implemented by subclasses

  /**
   * Establish connection to the service
   */
  public abstract connect(): Promise<void>;

  /**
   * Disconnect and cleanup resources
   */
  public abstract disconnect(): void;

  /**
   * Send text message
   */
  public abstract sendMessage(text: string): void;
}

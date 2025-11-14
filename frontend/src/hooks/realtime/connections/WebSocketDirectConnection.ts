/**
 * WebSocket Direct connection implementation for GPT Realtime API
 * Mode 2: WebSocket with manual audio encoding/decoding and base64 transmission
 */

import { RealtimeSessionBase } from '../core/RealtimeSessionBase';
import { requestSessionCredentials } from '../core/sessionManager';
import { handleResponseDone, handleTranscriptEvent } from '../core/messageHandler';
import { 
  createAudioContext, 
  float32ToInt16, 
  int16ToBase64,
  base64ToInt16,
  int16ToFloat32
} from '../core/audioUtils';
import { CLIENT_CONFIG as CONFIG, SYSTEM_PROMPT } from '@/lib/constants';

export class WebSocketDirectConnection extends RealtimeSessionBase {
  private websocket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaProcessor: ScriptProcessorNode | null = null;
  private audioQueueTime: number = 0;
  private audioSources: AudioBufferSourceNode[] = [];

  /**
   * Connect using WebSocket with ephemeral key
   */
  public async connect(): Promise<void> {
    try {
      this.updateState({ status: 'connecting' });
      
      // Load tools
      await this.loadTools();

      // Get session credentials
      const credentials = await requestSessionCredentials();
      this.log(`Session ID: ${credentials.sessionId}`);
      this.log('Ephemeral key received');

      // Start audio capture
      await this.startAudioCapture();

      // Initialize audio context
      this.audioContext = createAudioContext(24000);
      this.audioQueueTime = this.audioContext.currentTime;

      // Setup WebSocket connection
      await this.setupWebSocketConnection(credentials);

    } catch (error: any) {
      this.log(`Connection failed: ${error.message}`);
      this.updateState({ status: 'idle' });
      throw error;
    }
  }

  /**
   * Setup WebSocket connection
   */
  private async setupWebSocketConnection(credentials: any): Promise<void> {
    this.log('Setting up WebSocket connection...');

    // Determine WebSocket URL
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const backendHost = new URL(CONFIG.backendBaseUrl).host;
    const wsUrl = `${wsProtocol}://${backendHost}/realtime`;

    // Create WebSocket
    this.websocket = new WebSocket(wsUrl);

    // Setup event handlers
    this.websocket.onopen = () => {
      this.log('WebSocket opened');
      this.sendSessionUpdate();
      this.setupAudioInput();
      this.updateState({ status: 'connected' });
    };

    this.websocket.onmessage = async (event) => {
      const realtimeEvent = JSON.parse(event.data);
      await this.handleRealtimeEvent(realtimeEvent);
    };

    this.websocket.onclose = () => {
      this.log('WebSocket closed');
      this.updateState({ status: 'ended' });
    };

    this.websocket.onerror = (error) => {
      this.log(`WebSocket error: ${error}`);
    };
  }

  /**
   * Send session.update message with extended configuration
   */
  private sendSessionUpdate(): void {
    if (!this.websocket || !this.toolsData) return;

    const sessionPayload = {
      type: "session.update",
      session: {
        instructions: SYSTEM_PROMPT,
        input_audio_transcription: {
          model: "whisper-1"
        },
        // WebSocket-specific: turn detection configuration
        turn_detection: {
          type: 'server_vad',
          threshold: 0.7,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      },
    };

    // Add tools if available
    if (this.toolsData.tools.length > 0) {
      (sessionPayload.session as any).tools = this.toolsData.tools;
      (sessionPayload.session as any).tool_choice = this.toolsData.toolChoice;
    }

    this.websocket.send(JSON.stringify(sessionPayload));
    this.log(`Sent session.update with ${this.toolsData.tools.length} tools`);
  }

  /**
   * Setup audio input processing with ScriptProcessor
   */
  private setupAudioInput(): void {
    if (!this.audioContext || !this.clientMedia) return;

    const source = this.audioContext.createMediaStreamSource(this.clientMedia);
    this.mediaProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.mediaProcessor.onaudioprocess = (e) => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const int16Data = float32ToInt16(inputData);
      const base64Audio = int16ToBase64(int16Data);

      this.websocket.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64Audio
      }));
    };

    source.connect(this.mediaProcessor);
    this.mediaProcessor.connect(this.audioContext.destination);
    this.log('Audio input processing started');
  }

  /**
   * Handle incoming Realtime API events
   */
  private async handleRealtimeEvent(event: any): Promise<void> {
    console.log('[WebSocket Event]', event.type);

    switch (event.type) {
      case "session.error":
        this.log(`Error: ${event.error?.message || 'Unknown error'}`);
        break;

      case "session.end":
        this.log("Session ended by server");
        this.updateState({ status: 'ended' });
        break;

      case "response.audio.delta":
        // WebSocket-specific: play audio delta
        if (event.delta) {
          this.playAudioDelta(event.delta);
        }
        break;

      case "input_audio_buffer.speech_started":
        // WebSocket-specific: user interrupted, stop assistant audio
        this.log("User speech detected, stopping assistant audio");
        this.stopAssistantAudio();
        break;

      case "response.done":
        if (this.websocket) {
          await handleResponseDone(event, this.websocket, this.onMessage);
        }
        break;

      case "conversation.item.input_audio_transcription.completed":
      case "response.audio_transcript.done":
      case "response.output_text.done":
        handleTranscriptEvent(event, this.onMessage);
        break;

      case "response.output_audio_transcript.delta":
        // Just log deltas, final transcript comes later
        break;

      default:
        // Ignore other events
        break;
    }
  }

  /**
   * Play audio delta from base64
   */
  private playAudioDelta(base64Audio: string): void {
    if (!this.audioContext) return;

    try {
      // Decode base64 to Int16Array
      const int16Array = base64ToInt16(base64Audio);
      const float32Array = int16ToFloat32(int16Array);

      // Create audio buffer
      const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.copyToChannel(new Float32Array(float32Array), 0);

      // Create source and schedule playback
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(this.audioQueueTime, currentTime + 0.1);
      source.start(startTime);

      // Track audio source
      this.audioSources.push(source);
      this.audioQueueTime = startTime + audioBuffer.duration;

      // Remove from array when done
      source.onended = () => {
        const index = this.audioSources.indexOf(source);
        if (index > -1) {
          this.audioSources.splice(index, 1);
        }
      };
    } catch (error) {
      this.log(`Failed to play audio: ${error}`);
    }
  }

  /**
   * Stop all assistant audio playback (for interruption)
   */
  private stopAssistantAudio(): void {
    this.audioSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Ignore if already stopped
      }
    });
    this.audioSources = [];
    
    if (this.audioContext) {
      this.audioQueueTime = this.audioContext.currentTime;
    }
  }

  /**
   * Send text message via WebSocket
   */
  public sendMessage(text: string): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not ready");
    }

    if (!text.trim()) {
      throw new Error("Message cannot be empty");
    }

    const conversationEvent = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text,
          },
        ],
      },
    };

    this.websocket.send(JSON.stringify(conversationEvent));
    this.websocket.send(JSON.stringify({ type: "response.create" }));

    // Add user message to UI
    this.onMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    });

    this.log(`Sent text message: ${text}`);
  }

  /**
   * Disconnect and cleanup all resources
   */
  public disconnect(): void {
    this.log('Disconnecting...');

    // Close WebSocket
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.close();
    }
    this.websocket = null;

    // Stop audio processing
    if (this.mediaProcessor) {
      this.mediaProcessor.disconnect();
      this.mediaProcessor.onaudioprocess = null;
    }
    this.mediaProcessor = null;

    // Stop all audio sources
    this.stopAssistantAudio();

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.audioContext = null;

    // Stop audio capture
    this.stopAudioCapture();

    // Update state
    this.updateState({ status: 'idle', isMuted: false });
    this.log('Disconnected');
  }
}

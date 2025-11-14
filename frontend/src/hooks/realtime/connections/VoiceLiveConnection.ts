/**
 * Voice Live API connection implementation
 * Mode 3: WebSocket with binary audio transmission and AudioWorklet playback
 */

import { RealtimeSessionBase } from '../core/RealtimeSessionBase';
import { createAudioContext, float32ToInt16, int16ToFloat32 } from '../core/audioUtils';
import { CLIENT_CONFIG as CONFIG } from '@/lib/constants';

export class VoiceLiveConnection extends RealtimeSessionBase {
  private websocket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaProcessor: ScriptProcessorNode | null = null;
  private workletNode: AudioWorkletNode | null = null;

  /**
   * Connect using Voice Live API WebSocket
   */
  public async connect(): Promise<void> {
    try {
      this.updateState({ status: 'connecting' });
      
      // Load tools (if backend supports them)
      await this.loadTools();

      // Start audio capture
      await this.startAudioCapture();

      // Initialize audio context
      this.audioContext = createAudioContext(24000);

      // Load AudioWorklet for advanced playback
      await this.loadAudioWorklet();

      // Setup WebSocket connection
      await this.setupWebSocketConnection();

    } catch (error: any) {
      this.log(`Connection failed: ${error.message}`);
      this.updateState({ status: 'idle' });
      throw error;
    }
  }

  /**
   * Load AudioWorklet processor for ring buffer playback
   */
  private async loadAudioWorklet(): Promise<void> {
    if (!this.audioContext) return;

    try {
      // Load the audio processor module
      await this.audioContext.audioWorklet.addModule('/audio-processor.js');
      
      // Create worklet node
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
      this.workletNode.connect(this.audioContext.destination);
      
      this.log('AudioWorklet loaded successfully');
    } catch (error) {
      this.log(`Failed to load AudioWorklet: ${error}`);
      throw error;
    }
  }

  /**
   * Setup WebSocket connection to Voice Live API
   */
  private async setupWebSocketConnection(): Promise<void> {
    this.log('Setting up Voice Live WebSocket connection...');

    // Determine WebSocket URL for Voice Live API
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const backendHost = new URL(CONFIG.backendBaseUrl).host;
    const wsUrl = `${wsProtocol}://${backendHost}/web/ws`;

    // Create WebSocket with binary type
    this.websocket = new WebSocket(wsUrl);
    this.websocket.binaryType = 'arraybuffer';

    // Setup event handlers
    this.websocket.onopen = async () => {
      this.log('Voice Live WebSocket opened');
      
      // Resume audio context if suspended
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      this.setupAudioInput();
      this.updateState({ status: 'connected' });
    };

    this.websocket.onmessage = async (event) => {
      await this.handleVoiceLiveMessage(event);
    };

    this.websocket.onclose = () => {
      this.log('Voice Live WebSocket closed');
      this.updateState({ status: 'ended' });
    };

    this.websocket.onerror = (error) => {
      this.log(`Voice Live WebSocket error: ${error}`);
    };
  }

  /**
   * Setup audio input processing with binary transmission
   */
  private setupAudioInput(): void {
    if (!this.audioContext || !this.clientMedia) return;

    const source = this.audioContext.createMediaStreamSource(this.clientMedia);
    this.mediaProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.mediaProcessor.onaudioprocess = (e) => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const int16Data = float32ToInt16(inputData);
      
      // Send raw binary PCM (NOT base64)
      this.websocket.send(int16Data.buffer);
    };

    source.connect(this.mediaProcessor);
    this.mediaProcessor.connect(this.audioContext.destination);
    this.log('Audio input processing started (binary mode)');
  }

  /**
   * Handle incoming Voice Live API messages
   */
  private async handleVoiceLiveMessage(event: MessageEvent): Promise<void> {
    // Handle JSON messages
    if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data);
        
        if (msg.Kind === 'StopAudio') {
          this.log('Received StopAudio command');
          this.stopPlayback();
        } else if (msg.Kind === 'Transcription') {
          this.log(`Transcript: ${msg.Text}`);
          
          // Add transcript to UI
          this.onMessage({
            id: crypto.randomUUID(),
            role: msg.Speaker === 'user' ? 'user' : 'assistant',
            content: msg.Text,
            timestamp: Date.now()
          });
        } else {
          this.log(`Unknown message kind: ${msg.Kind}`);
        }
      } catch (error) {
        this.log(`Failed to parse JSON message: ${error}`);
      }
    }
    // Handle binary audio data
    else if (event.data instanceof ArrayBuffer) {
      this.playAudioBinary(event.data);
    } else {
      this.log(`Unknown message type: ${typeof event.data}`);
    }
  }

  /**
   * Play binary audio data using AudioWorklet
   */
  private playAudioBinary(arrayBuffer: ArrayBuffer): void {
    if (!this.workletNode || !this.audioContext) return;

    try {
      // Convert Int16 PCM to Float32
      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = int16ToFloat32(int16Array);

      // Send to AudioWorklet for buffered playback
      this.workletNode.port.postMessage({ pcm: float32Array });
    } catch (error) {
      this.log(`Failed to play audio: ${error}`);
    }
  }

  /**
   * Stop audio playback (clear worklet buffer)
   */
  private stopPlayback(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ clear: true });
    }
  }

  /**
   * Send text message (Voice Live API may not support this)
   */
  public sendMessage(text: string): void {
    this.log('Text messages not supported in Voice Live mode');
    
    // Add user message to UI anyway
    this.onMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    });
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

    // Clear worklet buffer
    this.stopPlayback();
    if (this.workletNode) {
      this.workletNode.disconnect();
    }
    this.workletNode = null;

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

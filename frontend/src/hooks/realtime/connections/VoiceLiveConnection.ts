/**
 * Voice Live API connection implementation
 * Mode 3: WebSocket with binary audio transmission and AudioWorklet playback
 */

import { RealtimeSessionBase } from '../core/RealtimeSessionBase';
import { requestSessionCredentials } from '../core/sessionManager';
import { createAudioContext, float32ToInt16, int16ToFloat32 } from '../core/audioUtils';
import { CLIENT_CONFIG as CONFIG, SYSTEM_PROMPT } from '@/lib/constants';
import { handleResponseDone } from '../core/messageHandler';

export class VoiceLiveConnection extends RealtimeSessionBase {
  private websocket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaProcessor: ScriptProcessorNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private voice?: string;
  private model?: string;
  
  // Track pending function call during Voice Live flow
  private pendingFunctionCall: {
    name: string;
    call_id: string;
    previous_item_id: string;
    arguments?: string;
  } | null = null;

  constructor(config: any, voice?: string, model?: string) {
    super(config);
    this.voice = voice;
    this.model = model;
  }

  /**
   * Connect using Voice Live API WebSocket
   */
  public async connect(): Promise<void> {
    try {
      this.updateState({ status: 'connecting' });
      
      // Load tools (if backend supports them)
      await this.loadTools();

      // Get session credentials (Voice Live uses 'voice-live' mode)
      const credentials = await requestSessionCredentials('voice-live' as any, this.voice, this.model);
      this.log(`Session ID: ${credentials.sessionId}`);
      this.log('Session credentials received');

      // Start audio capture
      await this.startAudioCapture();

      // Initialize audio context
      this.audioContext = createAudioContext(24000);

      // Load AudioWorklet for advanced playback
      await this.loadAudioWorklet();

      // Setup WebSocket connection
      await this.setupWebSocketConnection(credentials);

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
  private async setupWebSocketConnection(credentials: any): Promise<void> {
    this.log('Setting up Voice Live WebSocket connection...');

    // Use WebSocket URL from credentials and add ephemeral key authentication
    let wsUrl = credentials.realtimeUrl.replace(/^https?:/, 'wss:');
    
    // Add ephemeral key as query parameter for authentication
    const url = new URL(wsUrl);
    url.searchParams.set('api-key', credentials.ephemeralKey);
    wsUrl = url.toString();
    
    this.log(`Connecting to: ${wsUrl.replace(credentials.ephemeralKey, '***')}`);

    // Create WebSocket (text mode for Voice Live API)
    this.websocket = new WebSocket(wsUrl);

    // Setup event handlers
    this.websocket.onopen = async () => {
      this.log('Voice Live WebSocket opened');
      
      // Resume audio context if suspended
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // Send session configuration
      await this.sendSessionUpdate(credentials);
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
   * Send session configuration to Voice Live API
   */
  private async sendSessionUpdate(credentials: any): Promise<void> {
    if (!this.websocket || !this.toolsData) return;

    try {
      // Load configuration from public/session_config.json
      const response = await fetch('/session_config.json');
      if (!response.ok) {
        throw new Error(`Failed to load session config: ${response.statusText}`);
      }
      const sessionConfigs = await response.json();
      const baseConfig = sessionConfigs.voicelive;

      // Create session with loaded configuration
      const sessionConfig = {
        type: 'session.update',
        session: {
          ...baseConfig,
          instructions: SYSTEM_PROMPT,
        }
      };
      
      console.log("[VoiceLiveConnection] credentials model/voice:", credentials.model, credentials.voice);

      sessionConfig.session['model'] = credentials.model || baseConfig.model;
      sessionConfig.session['voice'] = {
        "name": credentials.voice || baseConfig.voice,
        "type": "azure-standard",
        "temperature": 0.3
      };
      
      console.log("[VoiceLiveConnection] List of available tools to send:", this.toolsData);
      console.log("[VoiceLiveConnection] Session config before sending:", sessionConfig);

      // Add tools if available
      if (this.toolsData.tools.length > 0) {
        (sessionConfig.session as any).tools = this.toolsData.tools;
        (sessionConfig.session as any).tool_choice = this.toolsData.toolChoice;
      }

      this.websocket.send(JSON.stringify(sessionConfig));
      this.log('Sent session configuration');
    } catch (error) {
      this.log(`Failed to load session config: ${error}`);
      throw error;
    }
  }

  /**
   * Setup audio input processing with base64 transmission
   */
  private setupAudioInput(): void {
    if (!this.audioContext || !this.clientMedia) return;

    const source = this.audioContext.createMediaStreamSource(this.clientMedia);
    this.mediaProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.mediaProcessor.onaudioprocess = (e) => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const int16Data = float32ToInt16(inputData);
      
      // Convert to base64 as expected by Voice Live API
      const uint8Array = new Uint8Array(int16Data.buffer);
      let binary = '';
      for (let i = 0; i < uint8Array.byteLength; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const base64Audio = btoa(binary);
      
      // Send audio via input_audio_buffer.append message
      const audioMessage = {
        type: 'input_audio_buffer.append',
        audio: base64Audio
      };
      
      this.websocket.send(JSON.stringify(audioMessage));
    };

    source.connect(this.mediaProcessor);
    this.mediaProcessor.connect(this.audioContext.destination);
    this.log('Audio input processing started (base64 mode)');
  }

  /**
   * Handle incoming Voice Live API messages
   */
  private async handleVoiceLiveMessage(event: MessageEvent): Promise<void> {
    if (typeof event.data !== 'string') {
      this.log(`Unexpected non-string message: ${typeof event.data}`);
      return;
    }

    try {
      const msg = JSON.parse(event.data);
      // console.log('[VoiceLive Event]', msg.type);
      
      switch (msg.type) {
        case 'session.updated':
          this.log('Session ready');
          this.setupAudioInput();
          this.updateState({ status: 'connected' });
          break;

        case 'input_audio_buffer.speech_started':
          this.log('User started speaking - stopping playback');
          this.stopPlayback();
          break;

        case 'input_audio_buffer.speech_stopped':
          this.log('User stopped speaking');
          break;

        case 'response.created':
          this.log('Assistant response created');
          break;

        case 'response.audio.delta':
          // Play audio delta
          if (msg.delta) {
            this.playAudioBase64(msg.delta);
          }
          break;

        case 'response.audio.done':
          this.log('Assistant finished speaking');
          break;

        case 'conversation.item.created':
          // Function call detected
          if (msg.item?.type === 'function_call') {
            const functionCallItem = msg.item;
            this.pendingFunctionCall = {
              name: functionCallItem.name,
              call_id: functionCallItem.call_id,
              previous_item_id: functionCallItem.id
            };
            this.log(`Function call detected: ${functionCallItem.name} (call_id: ${functionCallItem.call_id})`);
          }
          break;

        case 'response.function_call_arguments.done':
          // Function arguments received
          if (this.pendingFunctionCall && msg.call_id === this.pendingFunctionCall.call_id) {
            this.log(`Function arguments received for ${this.pendingFunctionCall.name}`);
            this.pendingFunctionCall.arguments = msg.arguments;
          }
          break;

        case 'response.done':
          this.log('Response complete');
          
          // Execute pending function call if arguments are ready
          if (this.pendingFunctionCall && this.pendingFunctionCall.arguments !== undefined) {
            await this.executeFunctionCall(this.pendingFunctionCall);
            this.pendingFunctionCall = null;
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // User transcript
          if (msg.transcript) {
            this.onMessage({
              id: crypto.randomUUID(),
              role: 'user',
              content: msg.transcript,
              timestamp: Date.now()
            });
          }
          break;

        case 'response.audio_transcript.done':
          // Assistant transcript
          if (msg.transcript) {
            this.onMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: msg.transcript,
              timestamp: Date.now()
            });
          }
          break;

        case 'error':
          this.log(`Voice Live error: ${msg.error?.message || 'Unknown error'}`);
          break;

        default:
          // this.log(`Unhandled event type: ${msg.type}`);
          break;
      }
    } catch (error) {
      this.log(`Failed to parse message: ${error}`);
    }
  }

  /**
   * Execute a function call (Voice Live flow)
   */
  private async executeFunctionCall(functionCall: { call_id: string; name: string; arguments: string; previous_item_id: string }): Promise<void> {
    if (!this.websocket) return;

    const callId = functionCall.call_id;
    const functionName = functionCall.name;
    let argumentsPayload: any = {};

    // Parse arguments
    try {
      argumentsPayload = functionCall.arguments ? JSON.parse(functionCall.arguments) : {};
    } catch (error) {
      this.log(`Failed to parse function arguments: ${error}`);
      argumentsPayload = {};
    }

    this.log(`Executing function: ${functionName} with args: ${JSON.stringify(argumentsPayload)}`);

    // Add tool call message to UI
    this.onMessage({
      id: crypto.randomUUID(),
      role: 'tool_call',
      content: `Calling ${functionName}`,
      timestamp: Date.now(),
      toolName: functionName,
      toolArgs: argumentsPayload
    });

    try {
      const response = await fetch(`${CONFIG.backendBaseUrl}/function-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: functionName,
          call_id: callId,
          arguments: argumentsPayload,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Backend error (${response.status}): ${detail}`);
      }

      const result = await response.json();
      
      // Add tool result message to UI
      this.onMessage({
        id: crypto.randomUUID(),
        role: 'tool_result',
        content: JSON.stringify(result.output, null, 2),
        timestamp: Date.now(),
        toolName: functionName
      });

      // Send function output back to Voice Live
      const conversationEvent = {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(result.output),
        },
      };

      this.websocket.send(JSON.stringify(conversationEvent));
      this.websocket.send(JSON.stringify({ type: "response.create" }));
      
      this.log(`Function ${functionName} executed successfully, requesting new response`);
    } catch (error: any) {
      this.log(`Function ${functionName} failed: ${error.message}`);
      
      // Send error back to Voice Live
      const errorPayload = { error: error.message };
      const conversationEvent = {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(errorPayload),
        },
      };

      this.websocket.send(JSON.stringify(conversationEvent));
      this.websocket.send(JSON.stringify({ type: "response.create" }));
    }
  }

  /**
   * Play base64-encoded audio delta
   */
  private playAudioBase64(base64Audio: string): void {
    if (!this.workletNode || !this.audioContext) return;

    try {
      // Decode base64 to binary
      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Convert Int16 PCM to Float32
      const int16Array = new Int16Array(bytes.buffer);
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

/**
 * WebRTC connection implementation for GPT Realtime API
 * Mode 1: Direct WebRTC connection with automatic audio handling
 */

import { RealtimeSessionBase } from '../core/RealtimeSessionBase';
import { requestSessionCredentials } from '../core/sessionManager';
import { handleResponseDone, handleTranscriptEvent } from '../core/messageHandler';
import { CLIENT_CONFIG as CONFIG, SYSTEM_PROMPT } from '@/lib/constants';

export class WebRTCConnection extends RealtimeSessionBase {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private audioElement: HTMLAudioElement | null = null;

  /**
   * Connect using WebRTC with ephemeral key
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

      // Setup WebRTC connection
      await this.setupWebRTCConnection(credentials);

    } catch (error: any) {
      this.log(`Connection failed: ${error.message}`);
      this.updateState({ status: 'idle' });
      throw error;
    }
  }

  /**
   * Setup WebRTC peer connection and data channel
   */
  private async setupWebRTCConnection(credentials: any): Promise<void> {
    this.log('Setting up WebRTC connection...');

    // Create peer connection
    this.peerConnection = new RTCPeerConnection();

    // Create audio element for playback
    this.audioElement = document.createElement('audio');
    this.audioElement.autoplay = true;
    document.body.appendChild(this.audioElement);

    // Handle incoming audio track
    this.peerConnection.ontrack = (event) => {
      this.log('Received remote audio track');
      if (this.audioElement) {
        this.audioElement.srcObject = event.streams[0];
      }
    };

    // Add local audio track
    if (this.clientMedia) {
      const audioTrack = this.clientMedia.getAudioTracks()[0];
      this.peerConnection.addTrack(audioTrack, this.clientMedia);
      this.log('Added local audio track');
    }

    // Create data channel
    this.dataChannel = this.peerConnection.createDataChannel('realtime-channel');
    this.setupDataChannelHandlers();

    // Create and send offer
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // Exchange SDP with server
    const sdpResponse = await fetch(
      `${credentials.realtimeUrl}?model=${encodeURIComponent(CONFIG.deployment)}`,
      {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${credentials.ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      }
    );

    if (!sdpResponse.ok) {
      throw new Error(`WebRTC negotiation failed (${sdpResponse.status})`);
    }

    const answerSdp = await sdpResponse.text();
    const answer: RTCSessionDescriptionInit = {
      type: "answer" as RTCSdpType,
      sdp: answerSdp,
    };
    await this.peerConnection.setRemoteDescription(answer);
    this.log('WebRTC connection established');
  }

  /**
   * Setup data channel event handlers
   */
  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) return;

    this.dataChannel.addEventListener('open', () => {
      this.log('Data channel opened');
      this.sendSessionUpdate();
      this.updateState({ status: 'connected' });
    });

    this.dataChannel.addEventListener('message', async (event) => {
      const realtimeEvent = JSON.parse(event.data);
      await this.handleRealtimeEvent(realtimeEvent);
    });

    this.dataChannel.addEventListener('close', () => {
      this.log('Data channel closed');
      this.updateState({ status: 'ended' });
    });

    this.dataChannel.addEventListener('error', (error) => {
      this.log(`Data channel error: ${error}`);
    });
  }

  /**
   * Send session.update message with configuration
   */
  private sendSessionUpdate(): void {
    if (!this.dataChannel || !this.toolsData) return;

    const sessionPayload = {
      type: "session.update",
      session: {
        instructions: SYSTEM_PROMPT,
        input_audio_transcription: {
          model: "whisper-1"
        }
      },
    };

    // Add tools if available
    if (this.toolsData.tools.length > 0) {
      (sessionPayload.session as any).tools = this.toolsData.tools;
      (sessionPayload.session as any).tool_choice = this.toolsData.toolChoice;
    }

    this.dataChannel.send(JSON.stringify(sessionPayload));
    this.log(`Sent session.update with ${this.toolsData.tools.length} tools`);
  }

  /**
   * Handle incoming Realtime API events
   */
  private async handleRealtimeEvent(event: any): Promise<void> {
    console.log('[WebRTC Event]', event.type);

    switch (event.type) {
      case "session.error":
        this.log(`Error: ${event.error?.message || 'Unknown error'}`);
        break;

      case "session.end":
        this.log("Session ended by server");
        this.updateState({ status: 'ended' });
        break;

      case "response.done":
        if (this.dataChannel) {
          await handleResponseDone(event, this.dataChannel, this.onMessage);
        }
        break;

      case "conversation.item.input_audio_transcription.completed":
      case "response.audio_transcript.done":
      case "response.output_text.done":
        handleTranscriptEvent(event, this.onMessage);
        break;

      case "response.output_audio_transcript.delta":
        // Just log deltas, final transcript comes in response.audio_transcript.done
        break;

      default:
        // Ignore other events
        break;
    }
  }

  /**
   * Send text message via data channel
   */
  public sendMessage(text: string): void {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      throw new Error("Data channel is not ready");
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

    this.dataChannel.send(JSON.stringify(conversationEvent));
    this.dataChannel.send(JSON.stringify({ type: "response.create" }));

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

    // Close data channel
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      this.dataChannel.close();
    }
    this.dataChannel = null;

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.getSenders().forEach(sender => sender.track?.stop());
      this.peerConnection.close();
    }
    this.peerConnection = null;

    // Remove audio element
    if (this.audioElement) {
      this.audioElement.remove();
    }
    this.audioElement = null;

    // Stop audio capture
    this.stopAudioCapture();

    // Update state
    this.updateState({ status: 'idle', isMuted: false });
    this.log('Disconnected');
  }
}

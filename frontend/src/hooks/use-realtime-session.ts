import { useState, useRef, useCallback } from 'react';
import { ChatMessage } from '@/lib/types';
import { CLIENT_CONFIG as CONFIG, SYSTEM_PROMPT } from '@/lib/constants';

interface SessionState {
  status: 'idle' | 'connecting' | 'connected' | 'ended';
  isMuted: boolean;
}

interface UseRealtimeSessionProps {
  onMessage: (message: ChatMessage) => void;
  onStateChange: (state: any) => void;
}



let cachedTools: any[] | null = null;
let toolChoice = "auto";

export function useRealtimeSession({ onMessage, onStateChange }: UseRealtimeSessionProps) {
  const [sessionState, setSessionState] = useState<SessionState>({
    status: 'idle',
    isMuted: false,
  });

  const sessionRef = useRef<{
    dataChannel: RTCDataChannel | null;
    peerConnection: RTCPeerConnection | null;
    clientMedia: MediaStream | null;
  }>({
    dataChannel: null,
    peerConnection: null,
    clientMedia: null,
  });

  const logMessage = useCallback((message: string) => {
    console.log('[VoiceCare]', message);
  }, []);

  const ensureToolsLoaded = useCallback(async () => {
    if (cachedTools !== null) {
      return;
    }

    const response = await fetch(`${CONFIG.backendBaseUrl}/tools`);
    if (!response.ok) {
      throw new Error(`Unable to retrieve tool definitions (${response.status})`);
    }

    const data = await response.json();
    cachedTools = data.tools ?? [];
    toolChoice = data.tool_choice ?? "auto";

    logMessage(`Loaded ${cachedTools?.length || 0} tool definition(s)`);
    
    // Log the actual tools for debugging
    logMessage(`Tools loaded: ${cachedTools?.map(t => t.name).join(', ') || 'none'}`);
  }, [logMessage]);

  const requestSession = useCallback(async () => {
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
      webrtcUrl: payload.webrtc_url,
    };
  }, []);

  const sendSessionUpdate = useCallback((dataChannel: RTCDataChannel, tools: any[], toolChoiceValue: string) => {
    const sessionPayload = {
      type: "session.update",
      session: {
        instructions: SYSTEM_PROMPT,
        input_audio_transcription: {
          model: "whisper-1"
        }
      },
    };

    if (Array.isArray(tools) && tools.length > 0) {
      (sessionPayload.session as any).tools = tools;
      (sessionPayload.session as any).tool_choice = toolChoiceValue ?? "auto";
    }

    dataChannel.send(JSON.stringify(sessionPayload));
    logMessage(`Sent session.update with ${tools.length} tools`);
  }, [logMessage]);

  const fulfillFunctionCall = useCallback(async (functionCallItem: any, dataChannel: RTCDataChannel) => {
    const callId = functionCallItem.call_id;
    const functionName = functionCallItem.name;
    const argumentsPayload = functionCallItem.arguments ?? {};

    logMessage(`Model requested function: ${functionName}`);

    // Add tool call message to UI
    onMessage({
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
      onMessage({
        id: crypto.randomUUID(),
        role: 'tool_result',
        content: JSON.stringify(result.output, null, 2),
        timestamp: Date.now(),
        toolName: functionName
      });

      sendFunctionCallOutput(dataChannel, callId, result.output);
      logMessage(`Provided output for ${functionName}`);
    } catch (error: any) {
      console.error(`Function ${functionName} failed`, error);
      const errorPayload = { error: error.message };
      sendFunctionCallOutput(dataChannel, callId, errorPayload);
      logMessage(`Function ${functionName} failed: ${error.message}`);
    }
  }, [logMessage, onMessage]);

  const sendFunctionCallOutput = useCallback((dataChannel: RTCDataChannel, callId: string, output: any) => {
    const conversationEvent = {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    };

    dataChannel.send(JSON.stringify(conversationEvent));
    dataChannel.send(JSON.stringify({ type: "response.create" }));
    logMessage(`Sent function_call_output for call ${callId}`);
  }, [logMessage]);

  const handleResponseDone = useCallback(async (event: any, dataChannel: RTCDataChannel) => {
    const response = event.response;
    if (!response || !Array.isArray(response.output)) {
      return;
    }

    for (const item of response.output) {
      if (item.type === "function_call") {
        await fulfillFunctionCall(item, dataChannel);
      }
    }
  }, [fulfillFunctionCall]);

  const initSession = useCallback(async ({ sessionId, ephemeralKey, webrtcUrl, tools, toolChoice }: any) => {
    logMessage(`Negotiating WebRTC connection for session ${sessionId}`);

    const peerConnection = new RTCPeerConnection();
    const audioElement = document.createElement('audio');
    audioElement.autoplay = true;
    document.body.appendChild(audioElement);

    peerConnection.ontrack = (event) => {
      audioElement.srcObject = event.streams[0];
    };

    const clientMedia = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioTrack = clientMedia.getAudioTracks()[0];
    peerConnection.addTrack(audioTrack);

    const dataChannel = peerConnection.createDataChannel('realtime-channel');

    sessionRef.current = {
      dataChannel,
      peerConnection,
      clientMedia,
    };

    dataChannel.addEventListener('open', () => {
      logMessage('Data channel is open');
      sendSessionUpdate(dataChannel, tools, toolChoice);
      setSessionState(prev => ({ ...prev, status: 'connected' }));
      onStateChange({ status: 'connected' });
    });

    dataChannel.addEventListener('message', async (event) => {
      const realtimeEvent = JSON.parse(event.data);
      console.log(realtimeEvent);

      if (realtimeEvent.type === "session.error") {
        logMessage(`Error: ${realtimeEvent.error.message}`);
      } else if (realtimeEvent.type === "session.end") {
        logMessage("Session ended.");
      } else if (realtimeEvent.type === "response.output_text.delta") {
        // Handle streaming text
      } else if (realtimeEvent.type === "response.output_text.done") {
        // Add assistant message
        if (realtimeEvent.text) {
          onMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: realtimeEvent.text,
            timestamp: Date.now()
          });
        }
      } else if (realtimeEvent.type === "response.output_audio_transcript.delta") {
        logMessage(`Transcript delta: ${realtimeEvent.delta}`);
      } else if (realtimeEvent.type === "response.audio_transcript.done") {
        // Handle completed AI audio transcript
        if (realtimeEvent.transcript) {
          onMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: realtimeEvent.transcript,
            timestamp: Date.now()
          });
        }
      } else if (realtimeEvent.type === "conversation.item.input_audio_transcription.completed") {
        // Handle user audio transcription
        if (realtimeEvent.transcript) {
          onMessage({
            id: crypto.randomUUID(),
            role: 'user',
            content: realtimeEvent.transcript,
            timestamp: Date.now()
          });
        }
      } else if (realtimeEvent.type === "response.done") {
        await handleResponseDone(realtimeEvent, dataChannel);
      }
    });

    dataChannel.addEventListener('close', () => {
      logMessage('Data channel is closed');
      setSessionState(prev => ({ ...prev, status: 'ended' }));
      onStateChange({ status: 'ended' });
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const sdpResponse = await fetch(`${webrtcUrl}?model=${encodeURIComponent(CONFIG.deployment)}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
    });

    if (!sdpResponse.ok) {
      throw new Error(`WebRTC negotiation failed (${sdpResponse.status})`);
    }

    const answer: RTCSessionDescriptionInit = { type: "answer" as RTCSdpType, sdp: await sdpResponse.text() };
    await peerConnection.setRemoteDescription(answer);
  }, [logMessage, sendSessionUpdate, handleResponseDone, onMessage, onStateChange]);

  const startSession = useCallback(async () => {
    try {
      setSessionState(prev => ({ ...prev, status: 'connecting' }));
      await ensureToolsLoaded();
      const session = await requestSession();

      logMessage("Ephemeral Key Received: ***");
      logMessage(`WebRTC Session Id = ${session.sessionId}`);

      await initSession({
        sessionId: session.sessionId,
        ephemeralKey: session.ephemeralKey,
        webrtcUrl: session.webrtcUrl,
        tools: cachedTools,
        toolChoice,
      });
    } catch (error: any) {
      console.error("Failed to start session", error);
      logMessage(`Error starting session: ${error.message}`);
      setSessionState(prev => ({ ...prev, status: 'idle' }));
      throw error;
    }
  }, [ensureToolsLoaded, requestSession, initSession, logMessage]);

  const endSession = useCallback(() => {
    const { dataChannel, peerConnection, clientMedia } = sessionRef.current;
    
    if (dataChannel && dataChannel.readyState === "open") {
      dataChannel.close();
    }
    if (peerConnection) {
      peerConnection.getSenders().forEach(sender => sender.track?.stop());
      peerConnection.close();
    }
    if (clientMedia) {
      clientMedia.getTracks().forEach(track => track.stop());
    }

    // Remove audio element
    const audioElements = document.querySelectorAll('audio[autoplay]');
    audioElements.forEach(el => el.remove());

    sessionRef.current = {
      dataChannel: null,
      peerConnection: null,
      clientMedia: null,
    };

    setSessionState({ status: 'idle', isMuted: false });
    logMessage("Session closed.");
  }, [logMessage]);

  const toggleMute = useCallback(() => {
    const { clientMedia } = sessionRef.current;
    if (clientMedia) {
      const audioTrack = clientMedia.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setSessionState(prev => ({ ...prev, isMuted: !audioTrack.enabled }));
      }
    }
  }, []);

  const sendTextMessage = useCallback((text: string) => {
    const { dataChannel } = sessionRef.current;
    if (!dataChannel || dataChannel.readyState !== "open") {
      throw new Error("Data channel is not ready. Start the session first.");
    }

    if (!text.trim()) {
      throw new Error("Please enter a message before sending.");
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

    dataChannel.send(JSON.stringify(conversationEvent));
    dataChannel.send(JSON.stringify({ type: "response.create" }));

    // Add user message to UI
    onMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    });

    logMessage(`Sent user text: ${text}`);
  }, [logMessage, onMessage]);

  const isConnected = sessionState.status === 'connected';

  // Get current media stream for voice activity detection
  const getCurrentMediaStream = useCallback((): MediaStream | null => {
    return sessionRef.current.clientMedia;
  }, []);

  return {
    sessionState,
    startSession,
    endSession,
    toggleMute,
    sendTextMessage,
    isConnected,
    getCurrentMediaStream,
  };
}
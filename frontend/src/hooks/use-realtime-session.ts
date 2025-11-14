import { useState, useRef, useCallback } from 'react';
import { ChatMessage } from '@/lib/types';
import { RealtimeSessionBase, SessionState } from './realtime/core/RealtimeSessionBase';
import { WebRTCConnection } from './realtime/connections/WebRTCConnection';
import { WebSocketDirectConnection } from './realtime/connections/WebSocketDirectConnection';
import { VoiceLiveConnection } from './realtime/connections/VoiceLiveConnection';

export type ConnectionMode = 'webrtc' | 'websocket-direct' | 'voice-live';

interface UseRealtimeSessionProps {
  onMessage: (message: ChatMessage) => void;
  onStateChange: (state: any) => void;
}

export function useRealtimeSession({ onMessage, onStateChange }: UseRealtimeSessionProps) {
  const [sessionState, setSessionState] = useState<SessionState>({
    status: 'idle',
    isMuted: false,
  });

  const sessionRef = useRef<{
    connection: RealtimeSessionBase | null;
    connectionMode: ConnectionMode | null;
  }>({
    connection: null,
    connectionMode: null,
  });

  // Handle state updates from connection
  const handleStateChange = useCallback((state: Partial<SessionState>) => {
    setSessionState(prev => ({ ...prev, ...state }));
    onStateChange(state);
  }, [onStateChange]);

  /**
   * Start session with specified connection mode
   */
  const startSession = useCallback(async (mode: ConnectionMode = 'webrtc') => {
    try {
      setSessionState(prev => ({ ...prev, status: 'connecting' }));

      // Create appropriate connection based on mode
      let connection: RealtimeSessionBase;

      switch (mode) {
        case 'webrtc':
          connection = new WebRTCConnection({
            onMessage,
            onStateChange: handleStateChange,
          });
          break;

        case 'websocket-direct':
          connection = new WebSocketDirectConnection({
            onMessage,
            onStateChange: handleStateChange,
          });
          break;

        case 'voice-live':
          connection = new VoiceLiveConnection({
            onMessage,
            onStateChange: handleStateChange,
          });
          break;

        default:
          throw new Error(`Unknown connection mode: ${mode}`);
      }

      // Connect
      await connection.connect();

      // Store connection reference
      sessionRef.current = {
        connection,
        connectionMode: mode,
      };

      console.log('[RealtimeSession]', `Connected using ${mode} mode`);
    } catch (error: any) {
      console.error('[RealtimeSession]', 'Failed to start session', error);
      setSessionState(prev => ({ ...prev, status: 'idle' }));
      throw error;
    }
  }, [onMessage, handleStateChange]);

  /**
   * End session and cleanup
   */
  const endSession = useCallback(() => {
    const { connection } = sessionRef.current;
    
    if (connection) {
      connection.disconnect();
    }

    sessionRef.current = {
      connection: null,
      connectionMode: null,
    };

    setSessionState({ status: 'idle', isMuted: false });
    console.log('[RealtimeSession]', 'Session ended');
  }, []);

  /**
   * Toggle microphone mute
   */
  const toggleMute = useCallback(() => {
    const { connection } = sessionRef.current;
    
    if (connection) {
      connection.toggleMute();
      const newState = connection.getSessionState();
      setSessionState(newState);
    }
  }, []);

  /**
   * Send text message
   */
  const sendTextMessage = useCallback((text: string) => {
    const { connection } = sessionRef.current;
    
    if (!connection) {
      throw new Error("No active connection. Start the session first.");
    }

    connection.sendMessage(text);
  }, []);

  const isConnected = sessionState.status === 'connected';

  /**
   * Get current media stream for voice activity detection
   */
  const getCurrentMediaStream = useCallback((): MediaStream | null => {
    const { connection } = sessionRef.current;
    return connection ? connection.getMediaStream() : null;
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
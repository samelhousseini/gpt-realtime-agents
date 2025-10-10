import { useState, useEffect, useRef, useCallback } from 'react';

interface VoiceActivityOptions {
  threshold?: number; // Audio level threshold (0-255)
  smoothing?: number; // Smoothing factor for level changes (0-1)
  minSpeakingTime?: number; // Minimum time to register as speaking (ms)
  minSilenceTime?: number; // Minimum silence time to stop speaking (ms)
}

interface VoiceActivityState {
  isSpeaking: boolean;
  audioLevel: number; // 0-100 normalized level
  isActive: boolean; // Whether detection is active
}

export function useVoiceActivity(
  mediaStream: MediaStream | null,
  options: VoiceActivityOptions = {}
) {
  const {
    threshold = 30,
    smoothing = 0.8,
    minSpeakingTime = 100,
    minSilenceTime = 300
  } = options;

  const [state, setState] = useState<VoiceActivityState>({
    isSpeaking: false,
    audioLevel: 0,
    isActive: false
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const speakingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const smoothedLevelRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
    
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    analyserRef.current = null;
    dataArrayRef.current = null;
  }, []);

  const analyzeAudio = useCallback(() => {
    if (!analyserRef.current || !dataArrayRef.current) return;

    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    
    // Calculate RMS (Root Mean Square) for more accurate voice detection
    let sum = 0;
    for (let i = 0; i < dataArrayRef.current.length; i++) {
      sum += dataArrayRef.current[i] * dataArrayRef.current[i];
    }
    const rms = Math.sqrt(sum / dataArrayRef.current.length);
    
    // Smooth the audio level
    smoothedLevelRef.current = smoothedLevelRef.current * smoothing + rms * (1 - smoothing);
    const normalizedLevel = Math.min(100, (smoothedLevelRef.current / 255) * 100);
    
    const isCurrentlySpeaking = smoothedLevelRef.current > threshold;
    
    // Update audio level immediately
    setState(prevState => ({
      ...prevState,
      audioLevel: normalizedLevel
    }));
    
    // Handle speaking state changes with debouncing
    setState(prevState => {
      if (isCurrentlySpeaking && !prevState.isSpeaking) {
        // Start speaking detection with delay
        if (speakingTimeoutRef.current) {
          clearTimeout(speakingTimeoutRef.current);
        }
        speakingTimeoutRef.current = setTimeout(() => {
          setState(s => ({ ...s, isSpeaking: true }));
        }, minSpeakingTime);
      } else if (!isCurrentlySpeaking && prevState.isSpeaking) {
        // Stop speaking detection with delay
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
        silenceTimeoutRef.current = setTimeout(() => {
          setState(s => ({ ...s, isSpeaking: false }));
        }, minSilenceTime);
      }
      
      return prevState;
    });
    
    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  }, [threshold, smoothing, minSpeakingTime, minSilenceTime]);

  useEffect(() => {
    if (!mediaStream) {
      cleanup();
      setState({ isSpeaking: false, audioLevel: 0, isActive: false });
      return;
    }

    // Check if we have audio tracks
    const audioTracks = mediaStream.getAudioTracks();
    if (audioTracks.length === 0) {
      setState({ isSpeaking: false, audioLevel: 0, isActive: false });
      return;
    }

    try {
      // Check for Web Audio API support
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) {
        console.warn('Web Audio API not supported - voice activity detection disabled');
        setState({ isSpeaking: false, audioLevel: 0, isActive: false });
        return;
      }

      // Create audio context and analyzer
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(mediaStream);
      
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.3;
      
      const bufferLength = analyserRef.current.frequencyBinCount;
      dataArrayRef.current = new Uint8Array(bufferLength);
      
      source.connect(analyserRef.current);
      
      setState(prevState => ({ ...prevState, isActive: true }));
      
      // Start analysis
      analyzeAudio();
      
    } catch (error) {
      console.error('Failed to setup voice activity detection:', error);
      setState({ isSpeaking: false, audioLevel: 0, isActive: false });
    }

    return cleanup;
  }, [mediaStream, analyzeAudio, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return state;
}
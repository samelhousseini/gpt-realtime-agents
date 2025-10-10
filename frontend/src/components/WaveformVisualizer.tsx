import { useEffect, useRef, memo } from 'react';
import { cn } from '@/lib/utils';

interface WaveformVisualizerProps {
  mediaStream: MediaStream | null;
  isActive: boolean;
  height?: number;
  width?: number;
  className?: string;
  color?: string;
  barCount?: number;
}

export const WaveformVisualizer = memo(({
  mediaStream,
  isActive,
  height = 40,
  width = 120,
  className,
  color = 'hsl(var(--primary))',
  barCount = 12
}: WaveformVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mediaStream || !isActive) {
      // Cleanup
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      // Clear canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          // Draw idle state
          drawIdleState(ctx, canvas.width, canvas.height);
        }
      }
      return;
    }

    const audioTracks = mediaStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    try {
      // Check for Web Audio API support
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) {
        console.warn('Web Audio API not supported - waveform visualization disabled');
        return;
      }

      // Setup audio analysis
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(mediaStream);
      
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 64; // Smaller FFT for simpler visualization
      analyserRef.current.smoothingTimeConstant = 0.6;
      
      const bufferLength = analyserRef.current.frequencyBinCount;
      dataArrayRef.current = new Uint8Array(bufferLength);
      
      source.connect(analyserRef.current);
      
      // Start animation
      draw();
    } catch (error) {
      console.error('Failed to setup waveform visualizer:', error);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [mediaStream, isActive, barCount]);

  const drawIdleState = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
    const barWidth = canvasWidth / barCount;
    const centerY = canvasHeight / 2;
    
    ctx.fillStyle = 'hsl(var(--muted-foreground))';
    ctx.globalAlpha = 0.3;
    
    for (let i = 0; i < barCount; i++) {
      const x = i * barWidth + barWidth / 4;
      const barHeight = 2;
      const y = centerY - barHeight / 2;
      
      ctx.fillRect(x, y, barWidth / 2, barHeight);
    }
    
    ctx.globalAlpha = 1;
  };

  const draw = () => {
    if (!analyserRef.current || !dataArrayRef.current || !canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    analyserRef.current.getByteFrequencyData(dataArrayRef.current);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = canvas.width / barCount;
    const maxHeight = canvas.height - 4; // Leave some padding

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, color + '80'); // Add transparency

    ctx.fillStyle = gradient;

    for (let i = 0; i < barCount; i++) {
      // Map bars to frequency data (focus on lower frequencies for voice)
      const dataIndex = Math.floor((i / barCount) * (dataArrayRef.current.length / 3));
      const value = dataArrayRef.current[dataIndex] || 0;
      
      // Normalize and apply some smoothing
      const normalizedValue = value / 255;
      const barHeight = Math.max(2, normalizedValue * maxHeight);
      
      const x = i * barWidth + barWidth / 4;
      const y = canvas.height - barHeight;
      
      // Add some randomness for more natural look
      const variance = 0.1;
      const adjustedHeight = barHeight * (1 + (Math.random() - 0.5) * variance);
      const adjustedY = canvas.height - adjustedHeight;
      
      ctx.fillRect(x, adjustedY, barWidth / 2, adjustedHeight);
    }

    animationFrameRef.current = requestAnimationFrame(draw);
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={cn('rounded-sm', className)}
      style={{ width, height }}
    />
  );
});
/**
 * Shared audio utility functions for all connection modes
 */

/**
 * Convert Float32Array audio data to Int16Array (PCM16)
 */
export function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * Convert Int16Array (PCM16) to Float32Array
 */
export function int16ToFloat32(int16Array: Int16Array): Float32Array {
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    const int = int16Array[i];
    const float = int < 0 ? int / 0x8000 : int / 0x7fff;
    float32Array[i] = float;
  }
  return float32Array;
}

/**
 * Convert Int16Array to Base64 string (for WebSocket transmission)
 */
export function int16ToBase64(int16Array: Int16Array): string {
  const byteArray = new Uint8Array(int16Array.buffer);
  let binary = '';
  for (let i = 0; i < byteArray.byteLength; i++) {
    binary += String.fromCharCode(byteArray[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 string to Int16Array (for audio playback)
 */
export function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

/**
 * Get user media with standard audio configuration
 */
export async function getUserMediaStream(): Promise<MediaStream> {
  return await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

/**
 * Stop all tracks in a media stream
 */
export function stopMediaStream(stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}

/**
 * Create an AudioContext with the specified sample rate
 */
export function createAudioContext(sampleRate: number = 24000): AudioContext {
  return new (window.AudioContext || (window as any).webkitAudioContext)({ 
    sampleRate 
  });
}

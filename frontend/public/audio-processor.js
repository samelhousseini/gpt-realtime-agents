/**
 * AudioWorklet processor for Voice Live API audio playback
 * Implements a ring buffer for smooth, continuous audio playback
 */

class RingBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(0);
    
    // Handle messages from main thread
    this.port.onmessage = (e) => {
      if (e.data.pcm) {
        // Append new audio data to buffer
        const next = new Float32Array(this.buffer.length + e.data.pcm.length);
        next.set(this.buffer);
        next.set(e.data.pcm, this.buffer.length);
        this.buffer = next;
      } else if (e.data.clear) {
        // Clear buffer (for interruption handling)
        this.buffer = new Float32Array(0);
      }
    };
  }

  /**
   * Process audio samples
   * Called by the audio system at regular intervals
   */
  process(inputs, outputs) {
    const output = outputs[0][0];
    
    if (this.buffer.length >= output.length) {
      // Fill output with buffered audio
      output.set(this.buffer.subarray(0, output.length));
      // Remove consumed samples from buffer
      this.buffer = this.buffer.subarray(output.length);
    } else {
      // Not enough data, output silence
      output.fill(0);
      this.buffer = new Float32Array(0);
    }
    
    // Return true to keep processor alive
    return true;
  }
}

// Register the processor
registerProcessor('audio-processor', RingBufferProcessor);

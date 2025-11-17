/**
 * Shared message and event handling logic for Realtime API protocol
 */

import { CLIENT_CONFIG as CONFIG } from '@/lib/constants';
import { ChatMessage } from '@/lib/types';

export type MessageChannel = RTCDataChannel | WebSocket;

/**
 * Send function call output back to the model
 */
export function sendFunctionCallOutput(
  channel: MessageChannel,
  callId: string,
  output: any
): void {
  const conversationEvent = {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(output),
    },
  };

  channel.send(JSON.stringify(conversationEvent));
  channel.send(JSON.stringify({ type: "response.create" }));
  
  console.log('[MessageHandler]', `Sent function_call_output for call ${callId}`);
}

/**
 * Fulfill a function call by invoking the backend
 */
export async function fulfillFunctionCall(
  functionCallItem: any,
  channel: MessageChannel,
  onMessage: (message: ChatMessage) => void
): Promise<void> {
  const callId = functionCallItem.call_id;
  const functionName = functionCallItem.name;
  const argumentsPayload = functionCallItem.arguments ?? {};

  console.log('[MessageHandler]', `Model requested function: ${functionName}`);

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

    sendFunctionCallOutput(channel, callId, result.output);
    console.log('[MessageHandler]', `Provided output for ${functionName}`);
  } catch (error: any) {
    console.error(`Function ${functionName} failed`, error);
    const errorPayload = { error: error.message };
    sendFunctionCallOutput(channel, callId, errorPayload);
    console.log('[MessageHandler]', `Function ${functionName} failed: ${error.message}`);
  }
}

/**
 * Handle response.done event to process function calls
 */
export async function handleResponseDone(
  event: any,
  channel: MessageChannel,
  onMessage: (message: ChatMessage) => void
): Promise<void> {
  const response = event.response;
  console.log('[MessageHandler]', 'Processing response.done event', event);
  if (!response || !Array.isArray(response.output)) {
    return;
  }

  for (const item of response.output) {
    if (item.type === "function_call") {
      await fulfillFunctionCall(item, channel, onMessage);
    }
  }
}

/**
 * Handle transcript events (user and assistant)
 */
export function handleTranscriptEvent(
  event: any,
  onMessage: (message: ChatMessage) => void
): void {
  // Handle user audio transcription
  if (event.type === "conversation.item.input_audio_transcription.completed") {
    if (event.transcript) {
      onMessage({
        id: crypto.randomUUID(),
        role: 'user',
        content: event.transcript,
        timestamp: Date.now()
      });
    }
  }
  // Handle assistant audio transcription
  else if (event.type === "response.audio_transcript.done") {
    if (event.transcript) {
      onMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: event.transcript,
        timestamp: Date.now()
      });
    }
  }
  // Handle assistant text output
  else if (event.type === "response.output_text.done") {
    if (event.text) {
      onMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: event.text,
        timestamp: Date.now()
      });
    }
  }
}

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EscalationState } from '@/lib/types';
import { Microphone, PaperPlaneTilt, User, Clock } from '@phosphor-icons/react';
import { VoiceActivityIndicator } from '@/components/VoiceActivityIndicator';
import { SimpleVoiceIndicator } from '@/components/SimpleVoiceIndicator';
import { useVoiceActivity } from '@/hooks/use-voice-activity';
import { useIsMobile } from '@/hooks/use-mobile';

interface ChatComposerProps {
  onSendMessage: (message: string) => void;
  onEscalate: () => void;
  escalationState: EscalationState;
  disabled?: boolean;
  getCurrentMediaStream: () => MediaStream | null;
  isConnected: boolean;
  isMuted: boolean;
}

export function ChatComposer({ 
  onSendMessage, 
  onEscalate, 
  escalationState, 
  disabled = false, 
  getCurrentMediaStream,
  isConnected,
  isMuted
}: ChatComposerProps) {
  const [message, setMessage] = useState('');
  const isMobile = useIsMobile();

  const mediaStream = getCurrentMediaStream();
  const voiceActivity = useVoiceActivity(
    isConnected && !isMuted ? mediaStream : null,
    {
      threshold: 25,
      smoothing: 0.7,
      minSpeakingTime: 100,
      minSilenceTime: 300
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const getEscalationButton = () => {
    switch (escalationState.status) {
      case 'available':
        return (
          <Button
            variant="outline"
            size="sm"
            onClick={onEscalate}
            disabled={disabled}
            className="gap-2"
          >
            <User size={16} />
            Request Human
          </Button>
        );
      case 'queued':
        return (
          <Badge variant="secondary" className="gap-2 py-2 px-3">
            <Clock size={16} />
            Queued
            {escalationState.queuePosition && ` (#${escalationState.queuePosition})`}
          </Badge>
        );
      case 'connected':
        return (
          <Badge variant="default" className="gap-2 py-2 px-3">
            <User size={16} />
            Connected to Human
          </Badge>
        );
    }
  };

  return (
    <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="p-4 space-y-3">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <div className="flex-1 relative">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Speak or type your question..."
              disabled={disabled}
              className="pr-12"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 gap-1"
              disabled={disabled}
            >
              <Microphone size={16} />
              {isMobile ? (
                <SimpleVoiceIndicator
                  isSpeaking={voiceActivity.isSpeaking}
                  isActive={voiceActivity.isActive}
                />
              ) : (
                <VoiceActivityIndicator
                  isSpeaking={voiceActivity.isSpeaking}
                  audioLevel={voiceActivity.audioLevel}
                  isActive={voiceActivity.isActive}
                  size="sm"
                />
              )}
            </Button>
          </div>
          
          <Button 
            type="submit" 
            disabled={disabled || !message.trim()}
            className="gap-2"
          >
            <PaperPlaneTilt size={16} />
            Send
          </Button>
        </form>

        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground">
              Press Enter to send • Click mic for voice input
            </div>
            {voiceActivity.isSpeaking && (
              <Badge variant="outline" className="text-xs py-1 px-2 gap-1">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                Listening
              </Badge>
            )}
          </div>
          
          {getEscalationButton()}
        </div>
      </div>
    </div>
  );
}
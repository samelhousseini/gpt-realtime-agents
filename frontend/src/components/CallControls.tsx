import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SessionState } from '@/lib/types';
import { Phone, PhoneX, Microphone, MicrophoneSlash } from '@phosphor-icons/react';
import { VoiceActivityIndicator } from '@/components/VoiceActivityIndicator';
import { WaveformVisualizer } from '@/components/WaveformVisualizer';
import { SimpleVoiceIndicator } from '@/components/SimpleVoiceIndicator';
import { useVoiceActivity } from '@/hooks/use-voice-activity';
import { useIsMobile } from '@/hooks/use-mobile';

interface CallControlsProps {
  sessionState: SessionState;
  onStartCall: () => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  getCurrentMediaStream: () => MediaStream | null;
}

export function CallControls({ sessionState, onStartCall, onEndCall, onToggleMute, getCurrentMediaStream }: CallControlsProps) {
  const isMobile = useIsMobile();
  const mediaStream = getCurrentMediaStream();
  const voiceActivity = useVoiceActivity(
    sessionState.status === 'connected' && !sessionState.isMuted ? mediaStream : null,
    {
      threshold: 25,
      smoothing: 0.7,
      minSpeakingTime: 150,
      minSilenceTime: 400
    }
  );

  const getStatusText = () => {
    switch (sessionState.status) {
      case 'idle': return 'Idle';
      case 'connecting': return 'Connecting';
      case 'connected': return 'Live';
      case 'ended': return 'Ended';
      default: return 'Unknown';
    }
  };

  const getStatusVariant = () => {
    switch (sessionState.status) {
      case 'idle': return 'secondary' as const;
      case 'connecting': return 'default' as const;
      case 'connected': return 'default' as const;
      case 'ended': return 'destructive' as const;
      default: return 'secondary' as const;
    }
  };

  const isConnected = sessionState.status === 'connected';
  const isConnecting = sessionState.status === 'connecting';
  
  return (
    <TooltipProvider>
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <Button
              onClick={isConnected ? onEndCall : onStartCall}
              disabled={isConnecting}
              variant={isConnected ? "destructive" : "default"}
              size="lg"
              className={`gap-2 px-6 py-3 text-base font-semibold ${
                !isConnected && !isConnecting ? 'start-call-pulse' : ''
              }`}
            >
              {isConnected ? (
                <>
                  <PhoneX size={22} />
                  End Call
                </>
              ) : (
                <>
                  <Phone size={22} />
                  {isConnecting ? 'Connecting...' : 'Start Call'}
                </>
              )}
            </Button>
            
            {isConnected && (
              <div className="flex items-center gap-1">
                <Button
                  onClick={onToggleMute}
                  variant="outline"
                  size="lg"
                  className="gap-2"
                >
                  {sessionState.isMuted ? (
                    <MicrophoneSlash size={20} />
                  ) : (
                    <Microphone size={20} />
                  )}
                </Button>
                {/* Voice activity indicator with tooltip */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center">
                      {/* Use simpler indicator on mobile for better performance */}
                      {isMobile ? (
                        <SimpleVoiceIndicator
                          isSpeaking={voiceActivity.isSpeaking}
                          isActive={voiceActivity.isActive && !sessionState.isMuted}
                          className="ml-1"
                        />
                      ) : (
                        <VoiceActivityIndicator
                          isSpeaking={voiceActivity.isSpeaking}
                          audioLevel={voiceActivity.audioLevel}
                          isActive={voiceActivity.isActive && !sessionState.isMuted}
                          size="sm"
                          className="ml-1"
                        />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {sessionState.isMuted 
                        ? "Microphone muted" 
                        : voiceActivity.isSpeaking 
                          ? "Voice detected" 
                          : voiceActivity.isActive 
                            ? "Listening for voice" 
                            : "Voice detection inactive"
                      }
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
            
            {/* Voice Activity Waveform - Only on desktop */}
            {isConnected && !sessionState.isMuted && !isMobile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-lg">
                    <WaveformVisualizer
                      mediaStream={mediaStream}
                      isActive={voiceActivity.isActive}
                      width={80}
                      height={24}
                      barCount={8}
                    />
                    {voiceActivity.isSpeaking && (
                      <span className="text-xs text-primary font-medium">Speaking</span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Live audio waveform - shows your voice activity</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Badge variant={getStatusVariant()}>
              {getStatusText()}
              {sessionState.isMuted && ' (Muted)'}
            </Badge>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
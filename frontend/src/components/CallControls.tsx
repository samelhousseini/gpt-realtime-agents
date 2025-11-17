import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SessionState } from '@/lib/types';
import { ConnectionMode } from '@/hooks/use-realtime-session';
import { Phone, PhoneX, Microphone, MicrophoneSlash, PhoneCall } from '@phosphor-icons/react';
import { VoiceActivityIndicator } from '@/components/VoiceActivityIndicator';
import { WaveformVisualizer } from '@/components/WaveformVisualizer';
import { SimpleVoiceIndicator } from '@/components/SimpleVoiceIndicator';
import { useVoiceActivity } from '@/hooks/use-voice-activity';
import { useIsMobile } from '@/hooks/use-mobile';
import { CLIENT_CONFIG, GPT_REALTIME_VOICES, VOICE_LIVE_VOICES, GPT_REALTIME_MODELS, VOICE_LIVE_MODELS } from '@/lib/constants';
import { toast } from 'sonner';
import logo from '@/assets/images/logo.png';

interface CallControlsProps {
  sessionState: SessionState;
  onStartCall: (connectionMode: ConnectionMode, voice?: string, model?: string) => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  getCurrentMediaStream: () => MediaStream | null;
  onConnectionModeChange: (mode: ConnectionMode) => void;
}

export function CallControls({ sessionState, onStartCall, onEndCall, onToggleMute, getCurrentMediaStream, onConnectionModeChange }: CallControlsProps) {
  const isMobile = useIsMobile();
  const mediaStream = getCurrentMediaStream();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isCallingMobile, setIsCallingMobile] = useState(false);
  
  const connectionMode = sessionState.connectionMode || 'webrtc';
  
  // Get voice and model lists based on connection mode
  const voiceList = connectionMode === 'voice-live' ? VOICE_LIVE_VOICES : GPT_REALTIME_VOICES;
  const modelList = connectionMode === 'voice-live' ? VOICE_LIVE_MODELS : GPT_REALTIME_MODELS;
  
  // Initialize with first item from the appropriate list, or fallback to CLIENT_CONFIG
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    const list = connectionMode === 'voice-live' ? VOICE_LIVE_VOICES : GPT_REALTIME_VOICES;
    return list.length > 0 ? list[0] : CLIENT_CONFIG.voice;
  });
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const list = connectionMode === 'voice-live' ? VOICE_LIVE_MODELS : GPT_REALTIME_MODELS;
    return list.length > 0 ? list[0] : CLIENT_CONFIG.deployment;
  });

  // Update selected voice and model when connection mode changes
  useEffect(() => {
    if (voiceList.length > 0 && !voiceList.includes(selectedVoice)) {
      setSelectedVoice(voiceList[0]);
    }
    if (modelList.length > 0 && !modelList.includes(selectedModel)) {
      setSelectedModel(modelList[0]);
    }
  }, [connectionMode, voiceList, modelList]);
  
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

  const handleCallMobile = async () => {
    if (!phoneNumber.trim()) {
      toast.error('Please enter a phone number');
      return;
    }

    setIsCallingMobile(true);
    try {
      const response = await fetch(`${CLIENT_CONFIG.backendBaseUrl}/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          number: phoneNumber,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Call failed: ${errorText}`);
      }

      const result = await response.json();
      toast.success(`Call initiated to ${phoneNumber}`);
      console.log('Call response:', result);
    } catch (error: any) {
      toast.error(`Failed to call: ${error.message}`);
      console.error('Call error:', error);
    } finally {
      setIsCallingMobile(false);
    }
  };
  
  return (
    <TooltipProvider>
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center justify-between p-4 gap-3 min-h-[80px]">
          {/* Left Section: Logo, Start Call Button, Connection Mode Dropdown */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <img src={logo} alt="VoiceCare Logo" className="h-12 flex-shrink-0" />
            <Button
              onClick={isConnected ? onEndCall : () => {
                console.log('[CallControls] Starting call with:', { connectionMode, selectedVoice, selectedModel });
                console.log('[CallControls] Voice list:', voiceList);
                console.log('[CallControls] Model list:', modelList);
                onStartCall(connectionMode, selectedVoice, selectedModel);
              }}
              disabled={isConnecting}
              variant={isConnected ? "destructive" : "default"}
              size="lg"
              className={`gap-2 px-6 py-3 text-base font-semibold flex-shrink-0 ${
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

            {/* Connection Mode Dropdown */}
            <Select 
              value={connectionMode} 
              onValueChange={(value: ConnectionMode) => onConnectionModeChange(value)}
              disabled={isConnected || isConnecting}
            >
              <SelectTrigger className="w-[180px] h-10 flex-shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="webrtc">WebRTC Direct</SelectItem>
                <SelectItem value="voice-live">Voice Live API</SelectItem>                
              </SelectContent>
            </Select>

            {/* Voice Selection Dropdown */}
            <Select 
              value={selectedVoice} 
              onValueChange={setSelectedVoice}
              disabled={isConnected || isConnecting}
            >
              <SelectTrigger className="w-[180px] h-10 flex-shrink-0">
                <SelectValue placeholder="Select voice" />
              </SelectTrigger>
              <SelectContent>
                {voiceList.map((voice) => (
                  <SelectItem key={voice} value={voice}>
                    {voice}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Model Selection Dropdown */}
            <Select 
              value={selectedModel} 
              onValueChange={setSelectedModel}
              disabled={isConnected || isConnecting}
            >
              <SelectTrigger className="w-[180px] h-10 flex-shrink-0">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelList.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {isConnected && (
              <div className="flex items-center gap-1 flex-shrink-0">
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
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-lg flex-shrink-0">
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
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Center Section: Mobile Calling Controls */}
          <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
            <Input
              type="tel"
              placeholder="Enter your phone number"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCallMobile()}
              className="w-full max-w-[220px]"
              disabled={isCallingMobile}
            />
            <Button
              onClick={handleCallMobile}
              disabled={isCallingMobile || !phoneNumber.trim()}
              variant="default"
              size="lg"
              className="gap-2 flex-shrink-0 whitespace-nowrap"
            >
              <PhoneCall size={20} />
              {isCallingMobile ? 'Calling...' : 'Call Mobile'}
            </Button>
            
            {/* Vertical Separator */}
            <div className="h-8 w-px bg-border mx-2 flex-shrink-0" />

            {/* Inbound Calling Info */}
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-lg flex-shrink-0">
              <Phone size={20} className="text-primary" />
              <span className="text-sm font-medium whitespace-nowrap">Call: +1 866 709 9132</span>
            </div>
          </div>

          {/* Right Section: Status Badge */}
          <div className="flex items-center gap-3 flex-shrink-0">
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
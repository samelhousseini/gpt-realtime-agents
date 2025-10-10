import { useState, useCallback, useEffect, useRef } from 'react';
import { useKV } from '@github/spark/hooks';
import { toast, Toaster } from 'sonner';
import { CallControls } from '@/components/CallControls';
import { SuggestionCards } from '@/components/SuggestionCards';
import { MessageBubble } from '@/components/MessageBubble';
import { ChatComposer } from '@/components/ChatComposer';
import { useRealtimeSession } from '@/hooks/use-realtime-session';
import { ChatMessage, EscalationState } from '@/lib/types';
import { IndustryType } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Trash } from '@phosphor-icons/react';

function App() {
  const [messages, setMessages] = useKV<ChatMessage[]>('chat-messages', []);
  const [selectedIndustry, setSelectedIndustry] = useKV<IndustryType>('selected-industry', 'telco');
  const [escalationState, setEscalationState] = useState<EscalationState>({ status: 'available' });
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const handleMessage = useCallback((message: ChatMessage) => {
    setMessages(prev => [...(prev || []), message]);
  }, [setMessages]);

  const handleStateChange = useCallback((state: any) => {
    if (state.status === 'connected') {
      toast.success('Call connected successfully');
    } else if (state.status === 'ended') {
      toast.info('Call ended');
    }
  }, []);

  const { sessionState, startSession, endSession, toggleMute, sendTextMessage, isConnected, getCurrentMediaStream } = useRealtimeSession({
    onMessage: handleMessage,
    onStateChange: handleStateChange
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleStartCall = async () => {
    try {
      await startSession();
    } catch (error: any) {
      toast.error(`Failed to start call: ${error.message}`);
    }
  };

  const handleSendMessage = (text: string) => {
    try {
      sendTextMessage(text);
    } catch (error: any) {
      toast.error(`Failed to send message: ${error.message}`);
    }
  };

  const handleSuggestionClick = (prompt: string) => {
    if (isConnected) {
      handleSendMessage(prompt);
    } else {
      toast.info('Please start a call first');
    }
  };

  const handleEscalate = () => {
    setEscalationState({ status: 'queued', queuePosition: 1 });
    toast.info('Connecting you to a human agent...');
    
    // Simulate queue processing
    setTimeout(() => {
      setEscalationState({ status: 'connected' });
      toast.success('Connected to human agent');
      
      // Add human agent message
      const humanMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'human_agent',
        content: 'Hi! I\'m a human agent taking over this conversation. I can see your chat history. How can I help you further?',
        timestamp: Date.now()
      };
      setMessages(prev => [...(prev || []), humanMessage]);
    }, 3000);
  };

  const handleClearChat = () => {
    setMessages([]);
    toast.info('Chat cleared');
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <CallControls
        sessionState={sessionState}
        onStartCall={handleStartCall}
        onEndCall={endSession}
        onToggleMute={toggleMute}
        getCurrentMediaStream={getCurrentMediaStream}
      />

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Panel - Suggestions (Fixed, Non-scrollable, Flexible) */}
        <div className="flex-1 border-r bg-muted/30 min-w-0 overflow-hidden">
          <div className="h-full p-4 flex flex-col min-h-0">
            <SuggestionCards
              onSuggestionClick={handleSuggestionClick}
              disabled={!isConnected}
              selectedIndustry={selectedIndustry || 'telco'}
              onIndustryChange={setSelectedIndustry}
            />
          </div>
        </div>

        {/* Right Panel - Chat (Flexible) */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 bg-card border-l overflow-hidden flex flex-col min-h-0">
            {/* Chat Header with Clear Button */}
            <div className="border-b p-3 flex items-center justify-between bg-card flex-shrink-0">
              <h3 className="font-semibold text-sm">Chat</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearChat}
                disabled={(messages || []).length === 0}
                className="h-8 px-2 text-xs"
              >
                <Trash size={14} className="mr-1" />
                Clear
              </Button>
            </div>

            {/* Chat Messages */}
            <div 
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 chat-scroll min-h-0"
            >
              {(messages || []).length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold mb-2">Welcome to VoiceCare</h3>
                    <p className="text-sm">Start a call or click a suggestion to begin</p>
                  </div>
                </div>
              ) : (
                (messages || []).map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))
              )}
            </div>

            {/* Chat Composer */}
            <div className="flex-shrink-0">
              <ChatComposer
                onSendMessage={handleSendMessage}
                onEscalate={handleEscalate}
                escalationState={escalationState}
                disabled={!isConnected}
                getCurrentMediaStream={getCurrentMediaStream}
                isConnected={isConnected}
                isMuted={sessionState.isMuted}
              />
            </div>
          </div>
        </div>
      </div>

      <Toaster position="top-right" />
    </div>
  );
}

export default App;
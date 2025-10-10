import { ChatMessage } from '@/lib/types';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { User, Robot, Wrench, CheckCircle, XCircle, Play } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: ChatMessage;
  className?: string;
}

export function MessageBubble({ message, className }: MessageBubbleProps) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isToolCall = message.role === 'tool_call';
  const isToolResult = message.role === 'tool_result';
  const isHuman = message.role === 'human_agent';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className={cn("flex justify-center my-1", className)}>
        <div className="bg-muted/50 border border-muted-foreground/20 rounded px-3 py-1 text-xs text-muted-foreground font-mono">
          {message.content}
        </div>
      </div>
    );
  }

  if (isToolCall) {
    return (
      <div className={cn("flex justify-center my-2", className)}>
        <Card className="bg-muted border-muted-foreground/20 max-w-md">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm">
              <Wrench size={16} className="text-muted-foreground" />
              <span className="font-medium">{message.toolName}</span>
              <Badge variant="outline" className="ml-auto">Tool Call</Badge>
            </div>
            {message.toolArgs && (
              <div className="mt-2 text-xs text-muted-foreground font-mono">
                {JSON.stringify(message.toolArgs, null, 2)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isToolResult) {
    const hasError = message.content.includes('error');
    return (
      <div className={cn("flex justify-center my-2", className)}>
        <Card className={cn(
          "max-w-md border-muted-foreground/20",
          hasError ? "bg-destructive/10 border-destructive/20" : "bg-muted"
        )}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm">
              {hasError ? (
                <XCircle size={16} className="text-destructive" />
              ) : (
                <CheckCircle size={16} className="text-green-600" />
              )}
              <span className="font-medium">{message.toolName}</span>
              <Badge 
                variant={hasError ? "destructive" : "default"}
                className="ml-auto"
              >
                {hasError ? 'Failed' : 'Success'}
              </Badge>
            </div>
            <div className="mt-2 text-xs text-muted-foreground font-mono max-h-32 overflow-y-auto">
              <pre className="whitespace-pre-wrap">{message.content}</pre>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex gap-3 mb-4",
      isUser ? "flex-row-reverse" : "flex-row",
      className
    )}>
      <Avatar className="w-8 h-8 flex-shrink-0">
        <AvatarFallback className={cn(
          isUser ? "bg-primary text-primary-foreground" : 
          isHuman ? "bg-accent text-accent-foreground" :
          "bg-secondary text-secondary-foreground"
        )}>
          {isUser ? (
            <User size={16} />
          ) : isHuman ? (
            <User size={16} />
          ) : (
            <Robot size={16} />
          )}
        </AvatarFallback>
      </Avatar>

      <div className={cn(
        "flex flex-col max-w-[70%]",
        isUser ? "items-end" : "items-start"
      )}>
        <div className={cn(
          "rounded-lg px-4 py-2 text-sm",
          isUser ? (
            "bg-primary text-primary-foreground"
          ) : isHuman ? (
            "bg-accent text-accent-foreground"
          ) : (
            "bg-muted text-muted-foreground"
          )
        )}>
          <div className="whitespace-pre-wrap">{message.content}</div>
          
          {message.audioUrl && (
            <div className="mt-2 pt-2 border-t border-current/20">
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-1 text-current hover:text-current"
                onClick={() => {
                  const audio = new Audio(message.audioUrl);
                  audio.play();
                }}
              >
                <Play size={14} />
                <span className="ml-1 text-xs">Play</span>
              </Button>
            </div>
          )}
        </div>
        
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
          <span>{formatTime(message.timestamp)}</span>
          {isHuman && <Badge variant="outline" className="text-xs">Human Agent</Badge>}
        </div>
      </div>
    </div>
  );
}
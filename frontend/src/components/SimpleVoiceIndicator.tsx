import { memo } from 'react';
import { cn } from '@/lib/utils';

interface SimpleVoiceIndicatorProps {
  isSpeaking: boolean;
  isActive: boolean;
  className?: string;
}

/**
 * A lightweight voice indicator for devices that might not support 
 * full Web Audio API or need better performance
 */
export const SimpleVoiceIndicator = memo(({ 
  isSpeaking, 
  isActive, 
  className 
}: SimpleVoiceIndicatorProps) => {
  if (!isActive) {
    return (
      <div className={cn(
        'w-3 h-3 rounded-full bg-muted border border-muted-foreground/20',
        className
      )} />
    );
  }

  return (
    <div className={cn(
      'flex items-center gap-1',
      className
    )}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cn(
            'w-1 h-4 rounded-full transition-all duration-200',
            isSpeaking ? 'bg-primary animate-pulse' : 'bg-muted-foreground/30',
            isSpeaking && 'animate-bounce'
          )}
          style={{
            animationDelay: `${i * 100}ms`,
            animationDuration: '600ms'
          }}
        />
      ))}
    </div>
  );
});
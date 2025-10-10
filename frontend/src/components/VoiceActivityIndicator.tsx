import { memo } from 'react';
import { cn } from '@/lib/utils';

interface VoiceActivityIndicatorProps {
  isSpeaking: boolean;
  audioLevel: number;
  isActive: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const VoiceActivityIndicator = memo(({ 
  isSpeaking, 
  audioLevel, 
  isActive, 
  size = 'md',
  className 
}: VoiceActivityIndicatorProps) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  const baseClasses = cn(
    'rounded-full border-2 transition-all duration-200 flex items-center justify-center',
    sizeClasses[size],
    className
  );

  if (!isActive) {
    return (
      <div className={cn(baseClasses, 'border-muted bg-muted/30')}>
        <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
      </div>
    );
  }

  // Calculate visual intensity based on audio level
  const intensity = Math.min(audioLevel / 50, 1); // Normalize to 0-1
  const glowIntensity = isSpeaking ? intensity : 0;

  return (
    <div 
      className={cn(
        baseClasses,
        isSpeaking ? 'border-primary bg-primary/20' : 'border-muted bg-muted/30',
        isSpeaking && 'voice-indicator-active'
      )}
      style={{
        boxShadow: isSpeaking 
          ? `0 0 ${8 + glowIntensity * 12}px rgba(var(--primary) / ${0.3 + glowIntensity * 0.4})`
          : 'none'
      }}
    >
      <div 
        className={cn(
          'rounded-full transition-all duration-150',
          isSpeaking ? 'bg-primary' : 'bg-muted-foreground/40'
        )}
        style={{
          width: `${20 + intensity * 60}%`,
          height: `${20 + intensity * 60}%`
        }}
      />
    </div>
  );
});
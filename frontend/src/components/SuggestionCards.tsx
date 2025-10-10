import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SuggestionCard } from '@/lib/types';
import { INDUSTRY_OPTIONS, INDUSTRY_CARD_MAP, IndustryType } from '@/lib/constants';
import * as PhosphorIcons from '@phosphor-icons/react';

interface SuggestionCardsProps {
  onSuggestionClick: (prompt: string) => void;
  disabled?: boolean;
  selectedIndustry: IndustryType;
  onIndustryChange: (industry: IndustryType) => void;
}

export function SuggestionCards({ 
  onSuggestionClick, 
  disabled = false, 
  selectedIndustry,
  onIndustryChange 
}: SuggestionCardsProps) {
  const currentCards = INDUSTRY_CARD_MAP[selectedIndustry];

  const handleCardClick = (card: SuggestionCard) => {
    if (disabled) return;
    onSuggestionClick(card.prompt);
  };

  const renderIcon = (iconName: string) => {
    const IconComponent = (PhosphorIcons as any)[iconName];
    return IconComponent ? <IconComponent size={14} weight="regular" /> : null;
  };

  const renderCard = (card: SuggestionCard) => (
    <Card 
      key={card.id} 
      className={`cursor-pointer transition-all hover:shadow-sm border h-full flex flex-col @container ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/30 hover:bg-accent/5'
      }`}
      onClick={() => handleCardClick(card)}
    >
      <CardContent className="p-2 flex flex-col items-center justify-center h-full text-center adaptive-text">
        <div className="text-primary/80 mb-1.5">
          {renderIcon(card.icon)}
        </div>
        <h3 className="font-medium adaptive-title mb-1 leading-tight text-wrap max-w-[80%]">{card.title}</h3>
        <p className="adaptive-subtitle text-muted-foreground leading-tight text-wrap max-w-[80%]">{card.subtitle}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h2 className="text-base font-semibold">Quick Help</h2>
        <Select value={selectedIndustry} onValueChange={onIndustryChange}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 grid-rows-5 gap-2 flex-1 min-h-0">
        {currentCards.map(renderCard)}
      </div>
    </div>
  );
}
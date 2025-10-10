import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CustomerProfile, RecentAction } from '@/lib/types';
import { Copy, ArrowCounterClockwise, User, CreditCard, Package } from '@phosphor-icons/react';

interface ContextPanelProps {
  customerProfile?: CustomerProfile;
  recentActions: RecentAction[];
  caseNotes: string[];
  onCopyNotes: () => void;
  onUndoAction: (actionId: string) => void;
}

export function ContextPanel({ 
  customerProfile, 
  recentActions, 
  caseNotes, 
  onCopyNotes, 
  onUndoAction 
}: ContextPanelProps) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="space-y-4">
      {/* Customer Profile */}
      {customerProfile && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <User size={16} />
              Customer Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div>
              <div className="font-medium text-sm">{customerProfile.name}</div>
              <div className="text-xs text-muted-foreground">
                Account: ••••{customerProfile.accountId.slice(-4)}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Package size={14} className="text-muted-foreground" />
              <span className="text-sm">{customerProfile.plan}</span>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard size={14} className="text-muted-foreground" />
                <span className="text-sm">${customerProfile.balance}</span>
              </div>
              {customerProfile.isVerified && (
                <Badge variant="default" className="text-xs">Verified</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Recent Actions</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {recentActions.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No recent actions
            </div>
          ) : (
            <div className="space-y-3">
              {recentActions.map((action, index) => (
                <div key={action.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{action.action}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {action.details}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatTime(action.timestamp)}
                      </div>
                    </div>
                    
                    {action.canUndo && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 w-6 p-0 flex-shrink-0"
                        onClick={() => onUndoAction(action.id)}
                      >
                        <ArrowCounterClockwise size={12} />
                      </Button>
                    )}
                  </div>
                  
                  {index < recentActions.length - 1 && (
                    <Separator className="mt-3" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Case Notes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            Case Notes
            <Button
              variant="outline"
              size="sm"
              onClick={onCopyNotes}
              className="h-6 px-2 text-xs"
            >
              <Copy size={12} className="mr-1" />
              Copy
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {caseNotes.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No case notes yet
            </div>
          ) : (
            <div className="space-y-2">
              {caseNotes.map((note, index) => (
                <div key={index} className="text-xs p-2 bg-muted rounded text-muted-foreground">
                  • {note}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
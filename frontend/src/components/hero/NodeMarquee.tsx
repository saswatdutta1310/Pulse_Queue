import React from 'react';
import { Database, FileSpreadsheet, Cpu, Webhook, AlertTriangle } from 'lucide-react';

// Real job handlers the platform actually supports (from shared/types.ts'
// JobType union) — not fabricated client/integration logos.
const HANDLERS: Array<{ label: string; icon: React.ElementType }> = [
  { label: 'Data Sync', icon: Database },
  { label: 'Report Export', icon: FileSpreadsheet },
  { label: 'Heavy Computation', icon: Cpu },
  { label: 'Webhook Dispatch', icon: Webhook },
  { label: 'Fault Simulation', icon: AlertTriangle }
];

export const NodeMarquee: React.FC = () => {
  const track = [...HANDLERS, ...HANDLERS];

  return (
    <div className="relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div className="marquee-track flex w-max items-center space-x-10">
        {track.map((item, i) => {
          const Icon = item.icon;
          return (
            <div key={i} className="flex items-center space-x-2 whitespace-nowrap text-white/40">
              <Icon className="h-4 w-4" />
              <span className="label-mono text-xs">{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

import React from 'react';
import type { StoryMode } from '../types';

interface ModeSelectorProps {
  selected: StoryMode;
  onChange: (mode: StoryMode) => void;
  disabled?: boolean;
}

const modes: {
  id: StoryMode;
  emoji: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  description: string;
  bullets: string[];
  gradient: string;
  border: string;
  selectedBg: string;
}[] = [
  {
    id: 'live',
    emoji: '⚡',
    title: 'Live Mode',
    subtitle: 'Ages 4–7',
    badge: 'Instant',
    badgeColor: 'bg-green-100 text-green-700',
    description: 'Puck meets your child and improvises a personalized story on the fly.',
    bullets: ['Starts instantly', 'Personalized greeting', 'Spontaneous adventures'],
    gradient: 'from-purple-500 to-pink-500',
    border: 'border-purple-400',
    selectedBg: 'bg-purple-50',
  },
  {
    id: 'agent',
    emoji: '🤖',
    title: 'Agent Mode',
    subtitle: 'Ages 7–12',
    badge: '~30-60s prep',
    badgeColor: 'bg-amber-100 text-amber-700',
    description: 'Our AI Storysmith agents craft a rich adventure before Puck begins.',
    bullets: ['Richer, structured plot', 'More complex challenges', 'Story prepared in advance'],
    gradient: 'from-blue-500 to-indigo-600',
    border: 'border-blue-400',
    selectedBg: 'bg-blue-50',
  },
];

export const ModeSelector: React.FC<ModeSelectorProps> = ({ selected, onChange, disabled }) => {
  return (
    <div className="w-full">
      <p className="text-center text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">
        Choose Story Mode
      </p>
      <div className="grid grid-cols-2 gap-4">
        {modes.map((mode) => {
          const isSelected = selected === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => !disabled && onChange(mode.id)}
              disabled={disabled}
              className={`
                relative text-left p-5 rounded-2xl border-2 transition-all duration-200
                ${isSelected
                  ? `${mode.border} ${mode.selectedBg} shadow-lg scale-[1.02]`
                  : 'border-gray-200 bg-white/60 hover:border-gray-300 hover:bg-white/80 hover:scale-[1.01]'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {/* Selected indicator */}
              {isSelected && (
                <span className={`absolute top-3 right-3 w-5 h-5 rounded-full bg-gradient-to-br ${mode.gradient} flex items-center justify-center`}>
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </span>
              )}

              <div className="flex items-start gap-3 mb-2">
                <span className="text-2xl">{mode.emoji}</span>
                <div>
                  <div className="font-bold text-gray-900 text-base leading-tight">{mode.title}</div>
                  <div className="text-xs text-gray-500">{mode.subtitle}</div>
                </div>
              </div>

              <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${mode.badgeColor}`}>
                {mode.badge}
              </span>

              <p className="text-xs text-gray-600 leading-relaxed mb-2">{mode.description}</p>

              <ul className="space-y-1">
                {mode.bullets.map((b, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className={`w-1.5 h-1.5 rounded-full bg-gradient-to-br ${mode.gradient} flex-shrink-0`} />
                    {b}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
};

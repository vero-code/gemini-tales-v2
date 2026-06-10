import React from 'react';
import type { ExerciseMode } from '../types';

interface ExerciseModeSelectorProps {
  selected: ExerciseMode;
  onChange: (mode: ExerciseMode) => void;
  disabled?: boolean;
}

const modes: {
  id: ExerciseMode;
  emoji: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  description: string;
  gradient: string;
  border: string;
  selectedBg: string;
}[] = [
  {
    id: 'sky_magic',
    emoji: '✨',
    title: 'Sky Magic',
    subtitle: 'Upper Body',
    badge: 'Arms',
    badgeColor: 'bg-cyan-100 text-cyan-700',
    description: 'Exercises focused on arms and upper body (like flying, reaching).',
    gradient: 'from-cyan-400 to-blue-500',
    border: 'border-cyan-400',
    selectedBg: 'bg-cyan-50',
  },
  {
    id: 'earth_magic',
    emoji: '🌿',
    title: 'Earth Magic',
    subtitle: 'Lower Body',
    badge: 'Legs',
    badgeColor: 'bg-emerald-100 text-emerald-700',
    description: 'Exercises focused on legs and lower body (like stomping, jumping).',
    gradient: 'from-emerald-400 to-green-500',
    border: 'border-emerald-400',
    selectedBg: 'bg-emerald-50',
  },
  {
    id: 'solar_power',
    emoji: '☀️',
    title: 'Solar Power',
    subtitle: 'Full Body',
    badge: 'All',
    badgeColor: 'bg-yellow-100 text-yellow-700',
    description: 'Full body exercises. Energy and movement everywhere!',
    gradient: 'from-yellow-400 to-orange-500',
    border: 'border-yellow-400',
    selectedBg: 'bg-yellow-50',
  },
];

export const ExerciseModeSelector: React.FC<ExerciseModeSelectorProps> = ({ selected, onChange, disabled }) => {
  return (
    <div className="w-full">
      <p className="text-center text-[10px] font-black text-purple-800 uppercase tracking-widest mb-3">
        Choose Exercise Focus
      </p>
      <div className="flex flex-col gap-3">
        {modes.map((mode) => {
          const isSelected = selected === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => !disabled && onChange(mode.id)}
              disabled={disabled}
              className={`
                relative text-left p-4 rounded-2xl border-2 transition-all duration-200 w-full
                ${isSelected
                  ? `${mode.border} ${mode.selectedBg} shadow-lg scale-[1.02]`
                  : 'border-gray-200 bg-white/60 hover:border-gray-300 hover:bg-white/80 hover:scale-[1.01]'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {isSelected && (
                <span className={`absolute top-3 right-3 w-4 h-4 rounded-full bg-gradient-to-br ${mode.gradient} flex items-center justify-center`}>
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </span>
              )}

              <div className="flex items-start gap-3">
                <span className="text-3xl flex-shrink-0">{mode.emoji}</span>
                <div className="flex-1 pr-4">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-purple-950 text-sm leading-none">{mode.title}</span>
                    <span className={`text-[9px] font-black tracking-wide uppercase px-2 py-0.5 rounded-full leading-none ${mode.badgeColor}`}>
                      {mode.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-purple-900/90 leading-snug font-medium">{mode.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

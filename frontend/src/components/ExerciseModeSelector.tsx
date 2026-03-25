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
    <div className="w-full mt-6">
      <p className="text-center text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">
        Choose Exercise Focus
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {modes.map((mode) => {
          const isSelected = selected === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => !disabled && onChange(mode.id)}
              disabled={disabled}
              className={`
                relative text-left p-4 rounded-2xl border-2 transition-all duration-200 flex flex-col items-center text-center
                ${isSelected
                  ? `${mode.border} ${mode.selectedBg} shadow-lg scale-[1.02]`
                  : 'border-gray-200 bg-white/60 hover:border-gray-300 hover:bg-white/80 hover:scale-[1.01]'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {isSelected && (
                <span className={`absolute top-2 right-2 w-4 h-4 rounded-full bg-gradient-to-br ${mode.gradient} flex items-center justify-center`}>
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </span>
              )}
              <span className="text-3xl mb-1">{mode.emoji}</span>
              <div className="font-bold text-gray-900 text-sm">{mode.title}</div>
              <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-1 mb-2 ${mode.badgeColor}`}>
                {mode.badge}
              </span>
              <p className="text-[11px] text-gray-600 leading-tight">{mode.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

import { useState } from 'react';

export interface AgentStep {
  agent: string;
  display_name: string;
  text: string;
  timestamp: number;
}

interface AgentPipelineTraceProps {
  steps: AgentStep[];
  finalStory: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const AGENT_CONFIG: Record<string, { icon: string; color: string; bg: string; border: string }> = {
  researcher: {
    icon: '🕵️',
    color: 'text-amber-800',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
  },
  judge: {
    icon: '⚖️',
    color: 'text-rose-800',
    bg: 'bg-rose-50',
    border: 'border-rose-300',
  },
  content_builder: {
    icon: '🧙‍♂️',
    color: 'text-indigo-800',
    bg: 'bg-indigo-50',
    border: 'border-indigo-300',
  },
  escalation_checker: {
    icon: '✅',
    color: 'text-green-800',
    bg: 'bg-green-50',
    border: 'border-green-300',
  },
  default: {
    icon: '🤖',
    color: 'text-purple-800',
    bg: 'bg-purple-50',
    border: 'border-purple-300',
  },
};

function StepCard({ step, index }: { step: AgentStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = AGENT_CONFIG[step.agent] ?? AGENT_CONFIG.default;
  const preview = step.text.slice(0, 160);
  const hasMore = step.text.length > 160;

  return (
    <div className="flex gap-3 animate-in slide-in-from-left-4 duration-300" style={{ animationDelay: `${index * 60}ms` }}>
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0 border-2 shadow-sm ${cfg.bg} ${cfg.border}`}>
          {cfg.icon}
        </div>
        <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
      </div>

      {/* Content */}
      <div className={`flex-1 mb-4 rounded-2xl border p-4 ${cfg.bg} ${cfg.border}`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`font-bold text-sm ${cfg.color}`}>{step.display_name}</span>
          <span className="text-xs text-gray-400">Step {index + 1}</span>
        </div>
        <p className={`text-sm leading-relaxed whitespace-pre-wrap ${cfg.color} opacity-90`}>
          {expanded ? step.text : preview}
          {!expanded && hasMore && '…'}
        </p>
        {hasMore && (
          <button
            onClick={() => setExpanded(v => !v)}
            className={`mt-2 text-xs font-semibold underline underline-offset-2 ${cfg.color} opacity-70 hover:opacity-100`}
          >
            {expanded ? 'Show less ↑' : 'Show full output ↓'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AgentPipelineTrace({ steps, finalStory, isOpen, onClose }: AgentPipelineTraceProps) {
  const [showFinalStory, setShowFinalStory] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-purple-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-purple-100 bg-gradient-to-r from-purple-50 to-indigo-50 flex-shrink-0">
          <div>
            <h2 className="font-black text-purple-900 text-lg">🪄 Agent Pipeline Trace</h2>
            <p className="text-xs text-purple-600 mt-0.5">{steps.length} agent steps completed</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/80 hover:bg-white flex items-center justify-center text-gray-500 hover:text-gray-800 shadow transition-all"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          <button
            onClick={() => setShowFinalStory(false)}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${!showFinalStory ? 'text-purple-700 border-b-2 border-purple-500 bg-purple-50/50' : 'text-gray-500 hover:text-gray-700'}`}
          >
            🔍 Agent Steps
          </button>
          <button
            onClick={() => setShowFinalStory(true)}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${showFinalStory ? 'text-indigo-700 border-b-2 border-indigo-500 bg-indigo-50/50' : 'text-gray-500 hover:text-gray-700'}`}
          >
            📖 Final Story
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">
          {!showFinalStory ? (
            <>
              {steps.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">No agent steps recorded yet.</p>
              ) : (
                <div>
                  {steps.map((step, i) => (
                    <StepCard key={`${step.agent}-${i}`} step={step} index={i} />
                  ))}
                  {/* Final tail dot */}
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg bg-gradient-to-br from-green-400 to-emerald-500 shadow-md text-white">
                        ✨
                      </div>
                    </div>
                    <div className="flex-1 mb-4 rounded-2xl border border-green-300 p-4 bg-green-50">
                      <span className="font-bold text-sm text-green-800">Story ready!</span>
                      <p className="text-sm text-green-700 mt-1 opacity-90">
                        The pipeline completed successfully. Switch to the "Final Story" tab to read it.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="prose prose-sm max-w-none">
              {finalStory ? (
                <div className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed font-medium">
                  {finalStory}
                </div>
              ) : (
                <p className="text-center text-gray-400 text-sm py-8">No final story yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

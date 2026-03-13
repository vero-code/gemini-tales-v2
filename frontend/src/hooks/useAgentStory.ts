import { useRef, useState } from 'react';

const PROXY_BASE_URL = (() => {
  const raw = import.meta.env.VITE_PROXY_URL || '';
  return raw
    .replace('ws://', 'http://')
    .replace('wss://', 'https://')
    .split('/ws/')[0];
})();

interface UseAgentStoryResult {
  fetchStory: (prompt?: string) => Promise<void>;
  storyText: string | null;
  isLoading: boolean;
  progress: string;
  error: string | null;
  reset: () => void;
}

export function useAgentStory(): UseAgentStoryResult {
  const [storyText, setStoryText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    abortRef.current?.abort();
    setStoryText(null);
    setIsLoading(false);
    setProgress('');
    setError(null);
  };

  const fetchStory = async (prompt = 'Create a new magical adventure with physical challenges for a child aged 7-12. Make it exciting and full of action.') => {
    reset();
    setIsLoading(true);
    setProgress('🚀 Waking up the Storysmith agents...');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${PROXY_BASE_URL}/api/chat_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, user_id: `puck_${Date.now()}` }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`Agent API error: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'progress') {
              setProgress(event.text);
            } else if (event.type === 'result') {
              setStoryText(event.text);
              setProgress('✨ Story is ready!');
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(`Failed to generate story: ${err.message}`);
      setProgress('');
    } finally {
      setIsLoading(false);
    }
  };

  return { fetchStory, storyText, isLoading, progress, error, reset };
}

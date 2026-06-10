import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import type { AppState, Achievement, StoryMode, ExerciseMode } from './types';
import { GeminiLiveAPI } from './utils/geminilive';
import { AudioStreamer, VideoStreamer, AudioPlayer } from './utils/mediaUtils';
import { INITIAL_ACHIEVEMENTS } from './config';
import { ModeSelector } from './components/ModeSelector';
import { ExerciseModeSelector } from './components/ExerciseModeSelector';
import { useAgentStory } from './hooks/useAgentStory';

// --- ENV VARIABLES ---
// --- DYNAMIC CONFIGURATION ---
let PROJECT_ID = import.meta.env.VITE_PROJECT_ID || import.meta.env.VITE_GCP_PROJECT;
let MODEL_ID = import.meta.env.VITE_MODEL_ID;
let MODEL_ID_IMAGE = import.meta.env.VITE_MODEL_ID_IMAGE;
let GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Auto-detect proxy URL
const rawProxyUrl = import.meta.env.VITE_PROXY_URL;
const PROXY_URL = rawProxyUrl 
  ? rawProxyUrl 
  : (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/proxy';

// SET TO false to use real Veo 3.1 video generation
const USE_MOCK_ANIMATION = true;
// SET TO false to use real Gemini image generation
const USE_MOCK_AVATAR = true;
// SET TO true to bypass the onboarding screen and load directly into the main story screen for testing
const BYPASS_ONBOARDING = true;

const App: React.FC = () => {
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Fetch dynamic config from backend if build-time variables are missing
  useEffect(() => {
    const loadConfig = async () => {
      // If we already have them from Vite build, just proceed
      if (PROJECT_ID && MODEL_ID && MODEL_ID_IMAGE && GEMINI_API_KEY) {
        setIsConfigLoaded(true);
        return;
      }

      try {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('Failed to fetch backend configuration');
        const data = await response.json();
        
        PROJECT_ID = PROJECT_ID || data.PROJECT_ID;
        MODEL_ID = MODEL_ID || data.MODEL_ID;
        MODEL_ID_IMAGE = MODEL_ID_IMAGE || data.MODEL_ID_IMAGE;
        GEMINI_API_KEY = GEMINI_API_KEY || data.GEMINI_API_KEY;

        if (!PROJECT_ID || !MODEL_ID || !MODEL_ID_IMAGE || !GEMINI_API_KEY) {
           throw new Error('Some required environment variables are still missing after backend fetch.');
        }
        
        setIsConfigLoaded(true);
      } catch (err) {
        console.error('Config Load Error:', err);
        setConfigError(err instanceof Error ? err.message : String(err));
      }
    };

    loadConfig();
  }, []);
  // --- STORY STATE ---
  const [appState, setAppState] = useState<AppState | 'IDLE' | 'STARTING' | 'STORYTELLING' | 'ERROR'>('IDLE');
  const [currentIllustration, setCurrentIllustration] = useState<string | null>(null);
  const [aiTranscription, setAiTranscription] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [achievements, setAchievements] = useState<Achievement[]>(INITIAL_ACHIEVEMENTS);
  const [lastAwarded, setLastAwarded] = useState<Achievement | null>(null);
  const [storyChoices, setStoryChoices] = useState<string[]>([]);
  const [heroicEnergy, setHeroicEnergy] = useState(0);
  const [lastMovement, setLastMovement] = useState<{type: string, energy: number} | null>(null);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [accumulatedStory, setAccumulatedStory] = useState<string[]>([]);
  const pendingStoryRef = useRef<string>('');
  const storyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- ONBOARDING & CHARACTER WORKSHOP ---
  const [isOnboarded, setIsOnboarded] = useState(BYPASS_ONBOARDING);
  const [characterStyle, setCharacterStyle] = useState<'elf' | 'wizard' | 'royal' | 'critter'>('elf');

  const getOnboardingDescription = (style: string) => {
    const stylePrompts = {
      elf: "a magical woodland elf with translucent wings, a green tunic, and a twig wand, cinematic live-action fantasy film style, highly detailed, realistic, photorealistic",
      wizard: "a young wizard with a glowing star staff, a pointy hat, and a starry blue cloak, cinematic live-action fantasy film style, highly detailed, realistic, photorealistic",
      royal: "a fairytale prince or princess with a glittering golden crown, a velvet cape, and noble features, cinematic live-action fantasy film style, highly detailed, realistic, photorealistic",
      critter: "a cute woodland creature like a talking fox or a child with cozy fox ears and a tiny green satchel, cinematic live-action fantasy film style, highly detailed, realistic, photorealistic"
    };
    return stylePrompts[style as keyof typeof stylePrompts] || stylePrompts.elf;
  };

  // --- MODE STATE ---
  const [storyMode, setStoryMode] = useState<StoryMode>('live');
  const [exerciseMode, setExerciseMode] = useState<ExerciseMode>('solar_power');
  const { fetchStory, storyText, isLoading: isAgentLoading, progress: agentProgress, error: agentError, reset: resetAgentStory } = useAgentStory();

  const [characterDescription, setCharacterDescription] = useState('a small woodland elf with translucent wings and a twig wand');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    BYPASS_ONBOARDING ? "https://placehold.co/400x400/805ad5/ffffff?text=Puck+ELF" : null
  );
  const [actionUrl, setActionUrl] = useState<string | null>(null);
  const [poseUrl, setPoseUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(
    BYPASS_ONBOARDING ? "https://www.w3schools.com/html/mov_bbb.mp4" : null
  );
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [isGeneratingAction, setIsGeneratingAction] = useState(false);
  const [isGeneratingPose, setIsGeneratingPose] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  
  // --- LYRIA MUSIC STATE ---
  const [backgroundMusicUrl, setBackgroundMusicUrl] = useState<string | null>(null);
  const [isGeneratingMusic, setIsGeneratingMusic] = useState(false);
  const [selectedMusicTheme, setSelectedMusicTheme] = useState<'forest' | 'sorcerer' | 'harp' | 'march'>('forest');

  // --- DEV PANEL STATE ---
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedCamera, setSelectedCamera] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isAudioOn, setIsAudioOn] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [chatMessages, setChatMessages] = useState<{sender: string, text: string, type: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [debugInfo, setDebugInfo] = useState('Application initialized...\n');

  // --- REFS ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const storyContainerRef = useRef<HTMLDivElement>(null);
  
  const liveClientRef = useRef<GeminiLiveAPI | null>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const videoStreamerRef = useRef<VideoStreamer | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const aiTranscriptRef = useRef<string>("");

  // --- DEVICE MANAGEMENT ---
  const fetchDevices = async () => {
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      const hasEmptyLabels = devices.some(d => !d.label);
      if (hasEmptyLabels) {
        logDebug("Requesting permission to read device names...");
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        tempStream.getTracks().forEach(track => track.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      }

      setMics(devices.filter(d => d.kind === 'audioinput'));
      setCameras(devices.filter(d => d.kind === 'videoinput'));
      logDebug("Devices refreshed successfully.");
    } catch (err) {
      logDebug("Device access error (or denied): " + err);
    }
  };

  useEffect(() => {
    fetchDevices();
    return () => disconnect();
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    if (storyContainerRef.current) {
      storyContainerRef.current.scrollTop = storyContainerRef.current.scrollHeight;
    }
  }, [accumulatedStory, aiTranscription]);

  // --- UTILS ---
  const logDebug = (msg: string) => {
    // console.log(`[DEBUG] ${msg}`);
    setDebugInfo(prev => `${msg}\n${prev}`.slice(0, 1500));
  };
  
  const appendChat = (sender: string, text: string, type: string) => {
    setChatMessages(prev => {
      const last = prev[prev.length - 1];
      
      if (last && last.sender === sender && sender === 'GEMINI' && type === 'transcript') {
        const newArr = [...prev];
        const oldText = last.text;

        let newText = text;

        if (text.startsWith(oldText)) {
            newText = text;
        } else if (oldText.startsWith(text)) {
            newText = oldText;
        } else {
            newText = text;
        }

        newArr[newArr.length - 1] = { ...last, text: newText };
        return newArr;
      }

      return [...prev, { sender, text, type }];
    });
  };

  const generateNewIllustration = async (prompt: string) => {
    if (!GEMINI_API_KEY) { logDebug("API Key missing for image gen."); return; }
    logDebug(`Generating image: ${prompt}`);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    try {
      const response = await ai.models.generateContent({
        model: MODEL_ID_IMAGE,
        contents: { parts: [{ text: `Magical watercolor illustration for children's story: ${prompt}` }] },
      });
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          setVideoUrl(null); // Clear video so illustration can show
          setCurrentIllustration(`data:image/png;base64,${part.inlineData.data}`);
          logDebug("Image generated successfully.");
          break;
        }
      }
    } catch (err) { logDebug("Image gen failed: " + err); }
  };

  const handleAwardBadge = (badgeId: string) => {
    logDebug(`Awarding badge: ${badgeId}`);
    setAchievements(prev => {
      const achievement = prev.find(a => a.id === badgeId);
      if (achievement && !achievement.unlocked) {
        setLastAwarded(achievement);
        setTimeout(() => setLastAwarded(null), 5000);
        return prev.map(a => a.id === badgeId ? { ...a, unlocked: true } : a);
      }
      return prev;
    });
  };

  const selectChoice = (choice: string) => {
    setStoryChoices([]);
    appendChat("YOU", `I choose: ${choice}`, "text");
    liveClientRef.current?.sendTextMessage(`I choose: ${choice}`);
  };


  const handleCreateAvatar = async () => {
    setIsGeneratingAvatar(true);
    setAvatarUrl(null);
    setActionUrl(null);
    logDebug("🧚 Imagining Puck's fairytale form...");
    
    if (USE_MOCK_AVATAR) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Use a nice placeholder representation of the chosen style
        const mockUrl = `https://placehold.co/400x400/805ad5/ffffff?text=Puck+${characterStyle.toUpperCase()}`;
        setAvatarUrl(mockUrl);
        setCurrentIllustration(mockUrl);
        logDebug("✓ Puck is ready! (Mock)");
      } catch (err) {
        logDebug("Failed to create mock avatar: " + err);
      } finally {
        setIsGeneratingAvatar(false);
      }
      return;
    }

    try {
      const backendUrl = PROXY_URL.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws/')[0];
      const dynamicDescription = getOnboardingDescription(characterStyle);
      const response = await fetch(`${backendUrl}/api/avatar/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: dynamicDescription })
      });
      const data = await response.json();
      if (data.path) {
        const fullPath = backendUrl + data.path;
        setAvatarUrl(fullPath);
        setCurrentIllustration(fullPath);
        logDebug("✓ Puck is ready!");
      }
    } catch (err) {
      logDebug("Failed to create avatar: " + err);
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  const handlePhotoUpload = async (file: File) => {
    setIsGeneratingAvatar(true);
    setAvatarUrl(null);
    setActionUrl(null);
    logDebug("📸 Imagining Puck from this photo...");
    
    if (USE_MOCK_AVATAR) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Use local object URL to display the uploaded photo instantly
        const mockUrl = URL.createObjectURL(file);
        setAvatarUrl(mockUrl);
        setCurrentIllustration(mockUrl);
        logDebug("✓ Puck's magic transformation complete! (Mock)");
      } catch (err) {
        logDebug("Failed to create mock photo avatar: " + err);
      } finally {
        setIsGeneratingAvatar(false);
      }
      return;
    }
    
    try {
      const backendUrl = PROXY_URL.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws/')[0];
      
      const formData = new FormData();
      formData.append('file', file);
      const dynamicDescription = getOnboardingDescription(characterStyle);
      formData.append('description', dynamicDescription);
      
      const response = await fetch(`${backendUrl}/api/avatar/from-photo`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      if (data.path) {
        const fullPath = backendUrl + data.path;
        setAvatarUrl(fullPath);
        setCurrentIllustration(fullPath);
        logDebug("✓ Puck's magic transformation complete!");
      }
    } catch (err) {
      logDebug("Photo transform failed: " + err);
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  const handleGenerateAction = async (action: string) => {
    setIsGeneratingAction(true);
    setActionUrl(null);
    logDebug(`🖼️ Painting Puck in action: ${action}...`);
    try {
      const backendUrl = PROXY_URL.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws/')[0];
      const response = await fetch(`${backendUrl}/api/avatar/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: action })
      });
      const data = await response.json();
      if (data.path) {
        const fullPath = backendUrl + data.path;
        setActionUrl(fullPath);
        // Also set as current illustration
        setCurrentIllustration(fullPath);
        logDebug("✓ Action captured!");
      }
    } catch (err) {
      logDebug("Failed to generate action: " + err);
    } finally {
      setIsGeneratingAction(false);
    }
  };

  const handleGeneratePose = async (pose: string) => {
    setIsGeneratingPose(true);
    setPoseUrl(null);
    logDebug(`🎭 Rotating Puck to view: ${pose}...`);
    try {
      const backendUrl = PROXY_URL.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws/')[0];
      const response = await fetch(`${backendUrl}/api/avatar/pose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: pose })
      });
      const data = await response.json();
      if (data.path) {
        const fullPath = backendUrl + data.path;
        setPoseUrl(fullPath);
        // Also set as current illustration
        setCurrentIllustration(fullPath);
        logDebug("✓ Puck rotated!");
      }
    } catch (err) {
      logDebug("Failed to generate pose: " + err);
    } finally {
      setIsGeneratingPose(false);
    }
  };

  const handleAnimatePuck = async () => {
    setIsGeneratingVideo(true);
    setVideoUrl(null);
    
    if (USE_MOCK_ANIMATION) {
      logDebug("🌿 Mocking Puck's Animation (using sample video)...");
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        setVideoUrl("https://www.w3schools.com/html/mov_bbb.mp4");
        setCurrentIllustration(null);
        logDebug("✓ Puck is ALIVE! (Mock animation complete)");
      } catch (err) {
        logDebug("Failed to animate Puck: " + err);
      } finally {
        setIsGeneratingVideo(false);
      }
      return;
    }

    logDebug("🌿 Sending Puck to the Animation Studio (Veo 3.1)...");
    const dynamicDescription = getOnboardingDescription(characterStyle);
    if (!dynamicDescription) {
      setIsGeneratingVideo(false);
      return;
    }
    
    try {
      const backendUrl = PROXY_URL.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws/')[0];
      const response = await fetch(`${backendUrl}/api/avatar/animate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: dynamicDescription })
      });
      const data = await response.json();
      if (data.path) {
        setCurrentIllustration(null); // Clear static image to show video
        setVideoUrl(backendUrl + data.path);
        logDebug("✓ Puck is ALIVE! Animation complete.");
      }
    } catch (err) {
      logDebug("Failed to animate Puck: " + err);
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const handleGenerateMusic = async (theme: 'forest' | 'sorcerer' | 'harp' | 'march') => {
    setIsGeneratingMusic(true);
    setSelectedMusicTheme(theme);
    logDebug(`🎵 Composing Puck's theme: ${theme}...`);
    
    const themeDescriptions = {
      forest: "whimsical woodland melodies with magical flutes, gentle acoustic guitar, and soft birds chirping, cinematic fantasy music",
      sorcerer: "mystical celestial chords, sparkling chime melodies, and magical starry synth pads, cinematic fantasy music",
      harp: "elegant royal palace harp music, light woodwinds, and soft classical fanfare, cinematic fantasy music",
      march: "brave heroic adventure march with soft horn fanfares, light marching drums, and orchestral strings, cinematic fantasy music"
    };
    
    try {
      const backendUrl = PROXY_URL.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws/')[0];
      const response = await fetch(`${backendUrl}/api/avatar/music`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: themeDescriptions[theme] })
      });
      const data = await response.json();
      if (data.path) {
        const fullPath = backendUrl + data.path;
        setBackgroundMusicUrl(fullPath);
        logDebug("✓ Puck's personal theme music composed!");
      }
    } catch (err) {
      logDebug("Failed to compose music: " + err);
    } finally {
      setIsGeneratingMusic(false);
    }
  };

  const sendText = () => {
    if (!chatInput.trim() || !liveClientRef.current) return;
    appendChat("YOU", chatInput, "text");
    liveClientRef.current.sendTextMessage(chatInput);
    setChatInput('');
  };

  // --- CORE LOGIC (Split into manual steps like Google Demo) ---
  const connect = async () => {
    setAppState('STARTING');
    setConnectionStatus('Connecting...');
    logDebug("Connecting to ADK Puck Agent...");

    try {
        const sessionId = Math.random().toString(36).substring(7);
        const baseUrl = PROXY_URL.split('/ws/proxy')[0]; 
        const adkUrl = `${baseUrl}/ws/puck_live/user1/${sessionId}?mode=${storyMode}&exercise_mode=${exerciseMode}`;

        // console.log("Starting connection to ADK:", adkUrl);
        logDebug(`Target URL: ${adkUrl}`);

        const client = new GeminiLiveAPI(adkUrl, PROJECT_ID, MODEL_ID);
        client.useADK = true;
        liveClientRef.current = client;

        // Backend ADK agent handles voice, instructions and modalities.
        // We only need to tell the client to expect/send transcriptions.
        client.inputAudioTranscription = true;
        client.outputAudioTranscription = true;

        // From Python-server through WebSocket.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.onReceiveResponse = async (message: any) => {
            const msgType = message.type;
            const data = message.data;

            if (!msgType) return;
            
            logDebug(`📨 [WS Receive] ${msgType}`);
            
            if (msgType === 'SETUP COMPLETE') {
              setConnectionStatus('Connected');
              setAppState('STORYTELLING');
              appendChat("SYSTEM", "Setup Complete. Ready!", "system");
              logDebug("✨ Protocol Synchronized! Puck is awake.");
              
              if (storyMode === 'agent' && storyText) {
                  logDebug("🤫 Handing over the drafted story to Puck...");
                  appendChat("SYSTEM", "Delivering the magic blueprint...", "system");
                  
                  const hiddenPrompt = `STORY BLUEPRINT:\n${storyText}\n\nINSTRUCTION: Tell this story exactly. Do not improvise other adventures. Greet the child now.`;
                  
                  // console.log("📤 [Puck Handoff] Story Length:", storyText.length);
                  liveClientRef.current?.sendTextMessage(hiddenPrompt);
              }
            } else if (msgType === 'OUTPUT_TRANSCRIPTION') {
                if (data && typeof data.text === 'string') {
                    const fullText = data.text;
                    const prevText = aiTranscriptRef.current;
                    
                    if (fullText.length > prevText.length) {
                        const delta = fullText.substring(prevText.length);
                        aiTranscriptRef.current = fullText;
                        
                        setAiTranscription(fullText);
                        appendChat("GEMINI", delta, "transcript");
                    }
                }
            } else if (msgType === 'AUDIO') {
                const audioLen = data?.length || 0;
                logDebug(`🎙️ AUDIO: Received ${audioLen} bytes of voice data`);
    
                if (!audioPlayerRef.current) {
                    logDebug("❌ ERROR: AudioPlayer is NULL!");
                    return;
                }
                
                if (!audioPlayerRef.current.isInitialized) {
                    logDebug("🔄 AudioPlayer needs init, attempting...");
                    await audioPlayerRef.current.init();
                }
                
                try {
                    if (audioLen > 0) {
                        logDebug("🎵 Feeding audio to player queue...");
                        await audioPlayerRef.current.play(data);
                        logDebug("✅ Audio chunk played successfully");
                    } else {
                        logDebug("⚠️ Received empty AUDIO chunk");
                    }
                } catch (err) {
                    logDebug(`❌ Playback error: ${err}`);
                }
            } else if (msgType === 'TEXT') {
                // Ignored - we use OUTPUT_TRANSCRIPTION for text deltas to avoid duplication!
            } else if (msgType === 'TURN COMPLETE') {
                logDebug("🏁 TURN_COMPLETE: Gemini finished this sentence.");

                const fragment = aiTranscriptRef.current.trim();
                aiTranscriptRef.current = "";

                if (fragment) {
                    if (fragment.length > pendingStoryRef.current.length) {
                        pendingStoryRef.current = fragment;
                    }
                }

                if (storyDebounceRef.current) clearTimeout(storyDebounceRef.current);
                storyDebounceRef.current = setTimeout(() => {
                    const paragraph = pendingStoryRef.current.trim();
                    if (paragraph) {
                        setAccumulatedStory(prev => {
                            if (prev.length > 0 && prev[prev.length - 1] === paragraph) return prev;
                            return [...prev, paragraph].slice(-20);
                        });
                    }
                    pendingStoryRef.current = '';
                }, 1500);

                setAiTranscription('');

                setChatMessages(prev => {
                    const newArr = [...prev];
                    const last = newArr[newArr.length - 1];
                    if (last && last.sender === 'GEMINI' && last.type === 'transcript') {
                        newArr[newArr.length - 1] = { ...last, type: 'text' };
                    }
                    return newArr;
                });

                setIsUserSpeaking(false);
            } else if (msgType === 'INTERRUPTED') {
                aiTranscriptRef.current = ""; // Reset
                setAiTranscription('(Story paused...)');
                setStoryChoices([]);
                appendChat("SYSTEM", "[Interrupted]", "system");
                audioPlayerRef.current?.interrupt();
            } else if (msgType === 'ERROR') {
                logDebug("🚨 Gemini Error: " + JSON.stringify(message.data));
                appendChat("SYSTEM", "AI encountered an error.", "system");
            } else if (msgType === 'TOOL_CALL' || msgType === 'TOOLCALL') {
                logDebug("🛠️ Gemini is using a tool...");
                const functionCalls = message.data?.functionCalls || [];
                
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                functionCalls.forEach((fc: any) => {
                   logDebug(`🛠️ Calling tool: ${fc.name} with arguments: ${JSON.stringify(fc.args)}`);
                   
                   if (fc.name === 'generateIllustration') {
                       generateNewIllustration(fc.args.prompt);
                   } else if (fc.name === 'awardBadge' || fc.name === 'award_badge') {
                       const id = fc.args.badgeId || fc.args.badge_id || fc.args.badgeid || fc.args.badge;
                       handleAwardBadge(id);
                   }
                });
            } else if (msgType === 'ILLUSTRATION') {
                logDebug(`🎨 New illustration received: ${message.data.url}`);
                // Extract base URL from proxy URL (e.g., http://localhost:8000)
                const backendUrl = PROXY_URL.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws/')[0];
                const fullUrl = message.data.url.startsWith('http') ? message.data.url : backendUrl + message.data.url;
                
                logDebug(`🖼️ Rendering full illustration URL: ${fullUrl}`);
                setVideoUrl(null);
                setCurrentIllustration(fullUrl);
                setAppState('STORYTELLING'); // Ensure we are out of IDLE/LOADING
                
                if (message.data.musicUrl) {
                  const fullMusicUrl = message.data.musicUrl.startsWith('http') ? message.data.musicUrl : backendUrl + message.data.musicUrl;
                  logDebug(`🎵 Playing custom background music: ${fullMusicUrl}`);
                  setBackgroundMusicUrl(fullMusicUrl);
                }
            } else if (msgType === 'MOVEMENT_RECORDED') {
                logDebug(`⚡ Movement detected: ${data.activityType} (+${data.energyGained} energy)`);
                setHeroicEnergy(prev => Math.min(prev + data.energyGained, 100)); // Cap at 100 for visual beauty
                setLastMovement({ type: data.activityType, energy: data.energyGained });
                setTimeout(() => setLastMovement(null), 3000);
            }
        };

        client.onConnectionStarted = () => {
            logDebug("🔌 WebSocket: Socket Opened! Waiting for SETUP_COMPLETE...");
            setAppState('STORYTELLING'); // Set to started when socket opens
        };

        client.onErrorMessage = (err: unknown) => {
            logDebug(`🚨 WebSocket Error: ${JSON.stringify(err)}`);
            setConnectionStatus('Error');
            setAppState('ERROR');
            appendChat("SYSTEM", "Connection failed. Check backend!", "system");
        };

        client.onClose = () => {
            logDebug("🌑 WebSocket: Socket Closed.");
            disconnect();
        };

        logDebug("📡 Connection: Opening socket to backend...");
        client.connect();

        const player = new AudioPlayer();
        logDebug("🔧 Initializing audio player...");
        try {
            await player.init();
            logDebug("✅ Audio player initialized successfully");
        } catch (initErr) {
            logDebug(`❌ Audio player init failed: ${initErr}`);
        }
        audioPlayerRef.current = player;

    } catch (error) {
        logDebug("Failed to connect: " + error);
        setConnectionStatus('Failed');
        setAppState('ERROR');
    }
  };

  const disconnect = () => {
    audioStreamerRef.current?.stop();
    videoStreamerRef.current?.stop();
    liveClientRef.current?.webSocket?.close();
    
    setAppState('IDLE');
    setConnectionStatus('Disconnected');
    setIsAudioOn(false);
    setIsVideoOn(false);
    setIsCameraActive(false);
    setCurrentIllustration(null);
    setVideoUrl(null);
    setStoryChoices([]);
    setAccumulatedStory([]);
    setAiTranscription('');
    resetAgentStory();
    setBackgroundMusicUrl(null);
    logDebug("Disconnected from Gemini.");

    if (storyDebounceRef.current) clearTimeout(storyDebounceRef.current);
    pendingStoryRef.current = '';
  };

  const toggleAudio = async () => {
    if (!liveClientRef.current) return logDebug("Connect first!");
    if (!isAudioOn) {
      try {
        if (!audioStreamerRef.current) audioStreamerRef.current = new AudioStreamer(liveClientRef.current);
        await audioStreamerRef.current.start(selectedMic || undefined);
        setIsAudioOn(true);
        appendChat("SYSTEM", "[Mic ON]", "system");
        logDebug("Audio streaming started.");
        // liveClientRef.current?.sendTextMessage("[SYSTEM]: Mic turned ON.");
      } catch (err: unknown) { logDebug("Audio error: " + err); }
    } else {
      audioStreamerRef.current?.stop();
      setIsAudioOn(false);
      appendChat("SYSTEM", "[Mic OFF]", "system");
      logDebug("Audio streaming stopped.");
      // liveClientRef.current?.sendTextMessage("[SYSTEM]: Mic turned OFF.");
    }
  };

  const toggleVideo = async () => {
    if (!liveClientRef.current) return logDebug("Connect first!");
    if (!isVideoOn) {
      try {
        if (!videoStreamerRef.current) {
            videoStreamerRef.current = new VideoStreamer(liveClientRef.current);
        }
        
        const video = await videoStreamerRef.current?.start({ width: 320, height: 240, fps: 1, deviceId: selectedCamera || null });
        
        if (videoRef.current && video?.srcObject) {
            videoRef.current.srcObject = video.srcObject;
        }

        setIsVideoOn(true);
        setIsCameraActive(true);
        appendChat("SYSTEM", "[Camera ON]", "system");
        logDebug("Video streaming started.");
        liveClientRef.current?.sendTextMessage("[SYSTEM]: Mirror is now ON. You can SEE clearly.");
      } catch (err: unknown) { logDebug("Video error: " + err); }
    } else {
      videoStreamerRef.current?.stop();
      setIsVideoOn(false);
      setIsCameraActive(false);
      appendChat("SYSTEM", "[Camera OFF]", "system");
      logDebug("Video streaming stopped.");
      liveClientRef.current?.sendTextMessage("[SYSTEM]: Mirror is now DARK. You are BLIND. Acknowledge and continue.");
    }
  };

  // --- RENDER HELPERS ---
  const formatStoryText = (text: string) => {
    // 1. Remove closed tags like [Camera OFF]
    // 2. Remove partial open tags like [Cam (important for streaming)
    return text.replace(/\[.*?\]/g, '').replace(/\[[^\]]*$/, '').replace(/\s\s+/g, ' ');
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4 md:p-8 space-y-8 overflow-y-auto bg-[#faf7f2]">
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*" 
        onChange={(e) => e.target.files?.[0] && handlePhotoUpload(e.target.files[0])} 
      />
      
      {/* --- BACKGROUND MUSIC (LYRIA 3) --- */}
      {isOnboarded && backgroundMusicUrl && (
        <audio 
          src={backgroundMusicUrl} 
          autoPlay 
          loop 
          className="hidden" 
          ref={(el) => { if (el) el.volume = 0.4; }} 
        />
      )}
      
      {/* --- CONFIG LOADING STATE --- */}
      {!isConfigLoaded && !configError && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Waking up the Magic Mirror...</h2>
          <p className="text-gray-500">Checking the cosmic parameters</p>
        </div>
      )}

      {/* --- CONFIG ERROR STATE --- */}
      {configError && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-6 text-center">
          <div className="text-6xl mb-4">🔮❌</div>
          <h2 className="text-2xl font-bold text-red-600 mb-4">The Magic Mirror is foggy</h2>
          <div className="bg-red-50 p-4 rounded-xl border border-red-100 max-w-md mb-6">
            <p className="text-red-800 font-mono text-sm">{configError}</p>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-purple-600 text-white rounded-full font-bold hover:bg-purple-700 transition-colors shadow-lg"
          >
            Try Again
          </button>
        </div>
      )}
      
      {/* --- ACHIEVEMENT POPUP --- */}
      {lastAwarded && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm animate-in fade-in duration-300">
           <div className="bg-white rounded-[40px] shadow-2xl p-10 border-8 border-yellow-400 flex flex-col items-center gap-4 animate-bounce">
            <span className="text-8xl">{lastAwarded.icon}</span>
            <div className="text-center">
              <h4 className="text-3xl font-black text-gray-800">Hooray! New badge!</h4>
              <p className="text-2xl text-purple-600 font-bold mt-2">{lastAwarded.title}</p>
            </div>
          </div>
        </div>
      )}

      {/* --- HEADER --- */}
      <header className="z-50 w-full max-w-[1600px] relative flex flex-col md:flex-row items-center justify-between gap-4 border-b border-purple-100 pb-4">
        <div className="flex flex-col md:flex-row items-baseline gap-2 md:gap-4 text-center md:text-left">
          <h1 className="text-3xl md:text-4xl font-extrabold bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent tracking-tight">
            Gemini Tales
          </h1>
          <p className="text-sm md:text-base text-purple-900/90 font-semibold italic">
            A magical world where stories come to life!
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Connection status badge */}
          <div className="flex items-center gap-2 bg-white/80 backdrop-blur-md border border-gray-200 rounded-full px-4 py-2 shadow-sm">
            <span className={`w-2.5 h-2.5 rounded-full ${connectionStatus === 'Connected' ? 'bg-green-500 animate-pulse' : 'bg-purple-500'}`}></span>
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
              {connectionStatus === 'Connected' ? 'Connected' : connectionStatus === 'Connecting...' ? 'Connecting' : 'Disconnected'}
            </span>
          </div>

          {/* Connect / Disconnect button */}
          {connectionStatus !== 'Connected' ? (
            <button 
              onClick={connect} 
              className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-full font-bold text-xs shadow-md transition-all active:scale-95 hover:shadow-lg"
            >
              Connect API
            </button>
          ) : (
            <button 
              onClick={disconnect} 
              className="px-5 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-full font-bold text-xs transition-all active:scale-95"
            >
              Disconnect
            </button>
          )}

          {/* Settings gear popover wrapper */}
          <div className="relative z-50">
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`p-2 rounded-full border border-gray-200 bg-white/80 hover:bg-purple-50 text-gray-600 hover:text-purple-600 transition-all shadow-sm flex items-center justify-center ${
                isSettingsOpen ? 'bg-purple-100 border-purple-300 text-purple-700' : ''
              }`}
              title="Device Settings"
              style={{ width: '36px', height: '36px' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.991a6.936 6.936 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0Z" />
              </svg>
            </button>

            {isSettingsOpen && (
              <div className="absolute right-0 top-full mt-2.5 w-80 bg-white/95 backdrop-blur-xl border border-purple-100 rounded-3xl shadow-2xl p-6 z-50 animate-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between mb-4 border-b border-purple-50 pb-2">
                  <h3 className="font-black text-purple-950 text-md flex items-center gap-2">
                    ⚙️ Mirror Settings
                  </h3>
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className="text-xs font-bold text-purple-600 hover:text-purple-800"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-4 text-left">
                  {/* Microphone selector */}
                  <div>
                    <label className="block text-[10px] font-black text-purple-800 uppercase tracking-widest mb-1.5">Microphone</label>
                    <select 
                      className="w-full border border-purple-100 rounded-xl p-2.5 bg-white text-xs font-semibold text-purple-950 focus:border-purple-400 outline-none" 
                      value={selectedMic} 
                      onChange={e => setSelectedMic(e.target.value)}
                    >
                      <option value="">Default Microphone</option>
                      {mics.map(m => <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}
                    </select>
                  </div>

                  {/* Camera selector */}
                  <div>
                    <label className="block text-[10px] font-black text-purple-800 uppercase tracking-widest mb-1.5">Camera</label>
                    <select 
                      className="w-full border border-purple-100 rounded-xl p-2.5 bg-white text-xs font-semibold text-purple-950 focus:border-purple-400 outline-none" 
                      value={selectedCamera} 
                      onChange={e => setSelectedCamera(e.target.value)}
                    >
                      <option value="">Default Camera</option>
                      {cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
                    </select>
                  </div>

                  {/* Audio/Video Streaming Toggles */}
                  <div className="flex gap-2 pt-2 border-t border-purple-50">
                    <button 
                      onClick={toggleAudio} 
                      disabled={connectionStatus !== 'Connected'}
                      className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-40 disabled:pointer-events-none ${
                        isAudioOn 
                          ? 'bg-green-100 text-green-700 border border-green-300' 
                          : 'bg-purple-50 text-purple-700 border border-purple-100 hover:bg-purple-100'
                      }`}
                    >
                      <span>{isAudioOn ? '🎙️ Mic ON' : '🎙️ Mic OFF'}</span>
                    </button>
                    <button 
                      onClick={toggleVideo} 
                      disabled={connectionStatus !== 'Connected'}
                      className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-40 disabled:pointer-events-none ${
                        isVideoOn 
                          ? 'bg-green-100 text-green-700 border border-green-300' 
                          : 'bg-purple-50 text-purple-700 border border-purple-100 hover:bg-purple-100'
                      }`}
                    >
                      <span>{isVideoOn ? '📷 Cam ON' : '📷 Cam OFF'}</span>
                    </button>
                  </div>
                  
                  {connectionStatus !== 'Connected' && (
                    <p className="text-[10px] text-purple-800/90 italic font-bold text-center mt-1">
                      * Connect API to enable microphone and camera streaming.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Debug Console toggle button */}
          <div className="relative z-50">
            <button
              onClick={() => setIsDebugOpen(!isDebugOpen)}
              className={`p-2 rounded-full border border-gray-200 bg-white/80 hover:bg-purple-50 text-gray-600 hover:text-purple-600 transition-all shadow-sm flex items-center justify-center ${
                isDebugOpen ? 'bg-purple-100 border-purple-300 text-purple-700' : ''
              }`}
              title="Debug Console"
              style={{ width: '36px', height: '36px' }}
            >
              <span className="text-lg">🐛</span>
            </button>

            {isDebugOpen && (
              <div className="absolute right-0 top-full mt-2.5 w-[500px] max-w-[90vw] bg-white/95 backdrop-blur-xl border border-purple-100 rounded-3xl shadow-2xl p-6 z-50 animate-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between mb-4 border-b border-purple-50 pb-2">
                  <h3 className="font-black text-purple-950 text-md flex items-center gap-2">
                    🐛 Debug Console
                  </h3>
                  <button 
                    onClick={() => setIsDebugOpen(false)}
                    className="text-xs font-bold text-purple-600 hover:text-purple-800"
                  >
                    Close
                  </button>
                </div>
                <pre className="border border-purple-100 bg-purple-950/90 text-green-400 rounded-2xl h-[300px] overflow-y-auto p-4 text-[11px] font-mono shadow-inner whitespace-pre-wrap text-left">
                  {debugInfo}
                </pre>
              </div>
            )}
          </div>

          {/* GitHub Repository link */}
          <a 
            href="https://github.com/vero-code/gemini-tales" 
            target="_blank" 
            rel="noopener noreferrer"
            className="p-2 rounded-full border border-gray-200 bg-white/80 hover:bg-purple-50 text-gray-600 hover:text-purple-600 transition-all shadow-sm flex items-center justify-center group"
            title="GitHub Repository"
            style={{ width: '36px', height: '36px' }}
          >
            <svg height="18" viewBox="0 0 16 16" version="1.1" width="18" aria-hidden="true" className="fill-current text-gray-600 group-hover:text-purple-600 transition-colors">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
            </svg>
          </a>
        </div>
      </header>

      {/* --- MAIN STORY EXPERIENCE (Beautiful UI) --- */}
      <main className="w-full max-w-[1600px] flex-1 flex flex-col lg:flex-row gap-8">
        {!isOnboarded ? (
          <div className="w-full max-w-3xl mx-auto flex flex-col gap-6 animate-in fade-in duration-500">
            <div className="glass-card rounded-[40px] p-8 shadow-xl bg-white/60 border border-white/50 backdrop-blur-md text-center">
              
              {/* Conditional Title and Subtitle depending on Step */}
              {!avatarUrl ? (
                <>
                  <h2 className="text-3xl font-black bg-gradient-to-r from-purple-700 to-pink-600 bg-clip-text text-transparent flex items-center justify-center gap-2 mb-2">
                    🔮 Step 1 of 3: Activate the Magic Mirror
                  </h2>
                  <p className="text-purple-900/90 font-bold mb-6">
                    Choose Puck's style, then upload a photo of the child to create your unique fairytale hero!
                  </p>
                </>
              ) : !videoUrl ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <button 
                      onClick={() => {
                        setAvatarUrl(null);
                        setCurrentIllustration(null);
                      }}
                      className="px-4 py-2 text-xs font-black text-purple-700 hover:text-white bg-purple-100 hover:bg-purple-600 rounded-full transition-all flex items-center gap-1 shadow-sm"
                    >
                      ⬅ Back
                    </button>
                    <h2 className="text-2xl font-black bg-gradient-to-r from-purple-700 to-pink-600 bg-clip-text text-transparent">
                      🎬 Step 2 of 3: Animate Puck
                    </h2>
                    <div className="w-16"></div> {/* Spacer for center alignment */}
                  </div>
                  <p className="text-purple-900/90 font-bold mb-6">
                    Watch Puck wake up and smile in the magic mirror!
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <button 
                      onClick={() => {
                        setVideoUrl(null);
                        setBackgroundMusicUrl(null);
                      }}
                      className="px-4 py-2 text-xs font-black text-purple-700 hover:text-white bg-purple-100 hover:bg-purple-600 rounded-full transition-all flex items-center gap-1 shadow-sm"
                    >
                      ⬅ Back
                    </button>
                    <h2 className="text-2xl font-black bg-gradient-to-r from-purple-700 to-pink-600 bg-clip-text text-transparent">
                      🎵 Step 3 of 3: Choose Music Theme
                    </h2>
                    <div className="w-16"></div> {/* Spacer for center alignment */}
                  </div>
                  <p className="text-purple-900/90 font-bold mb-6">
                    Compose a custom magical tune inspired by your hero's appearance.
                  </p>
                </>
              )}
              
              {/* Step 1 Style Grid (Only shown when no avatar is generated yet) */}
              {!avatarUrl && (
                <div className="mb-6 text-left animate-in fade-in duration-300">
                  <label className="text-xs font-black text-purple-700 uppercase tracking-widest block mb-3">1. Select Puck's Style</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { id: 'elf', icon: '🧚', label: 'Elf', desc: 'Magic Woodland Elf' },
                      { id: 'wizard', icon: '🪄', label: 'Wizard', desc: 'Young Sorcerer' },
                      { id: 'royal', icon: '👑', label: 'Royal', desc: 'Prince / Princess' },
                      { id: 'critter', icon: '🦊', label: 'Critter', desc: 'Fox / Woodland Animal' }
                    ].map(style => (
                      <button 
                        key={style.id}
                        onClick={() => setCharacterStyle(style.id as any)}
                        className={`p-4 rounded-3xl border-2 transition-all flex flex-col items-center text-center ${characterStyle === style.id ? 'bg-white border-purple-500 shadow-md scale-105' : 'bg-white/40 border-transparent hover:bg-white/60'}`}
                      >
                        <span className="text-4xl mb-2">{style.icon}</span>
                        <span className="text-sm font-black text-purple-950">{style.label}</span>
                        <span className="text-[10px] text-purple-900/85 font-bold leading-tight mt-1">{style.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Zone */}
              <div className="border-t border-purple-100 pt-6">
                {!avatarUrl ? (
                  // STEP 1 UPLOAD ZONE OR DEFAULT GENERATION
                  <div className="space-y-6">
                    <div 
                      onClick={() => fileInputRef.current?.click()} 
                      className={`border-4 border-dashed rounded-[30px] p-8 text-center cursor-pointer transition-all ${
                        isGeneratingAvatar 
                          ? 'bg-purple-50/20 border-purple-300 pointer-events-none' 
                          : 'bg-white/40 border-purple-200 hover:border-purple-500 hover:bg-white/60'
                      }`}
                    >
                      {isGeneratingAvatar ? (
                        <div className="flex flex-col items-center gap-4">
                          <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                          <p className="text-purple-900 font-extrabold text-lg animate-pulse">🧙‍♂️ Weaving magic details... (Creating character)</p>
                        </div>
                      ) : (
                        <>
                          <span className="text-6xl block mb-2 animate-bounce">📸</span>
                          <span className="font-black text-purple-950 block text-xl mb-1">Upload the Hero's Photo</span>
                          <span className="text-purple-900/85 text-sm font-bold">We will transform you into the fairytale hero!</span>
                        </>
                      )}
                    </div>
                    
                    {!isGeneratingAvatar && (
                      <>
                        <div className="text-center text-xs font-black text-purple-800/60 tracking-wider uppercase">— OR —</div>
                        <button 
                          onClick={handleCreateAvatar}
                          disabled={isGeneratingAvatar}
                          className="w-full bg-purple-600 hover:bg-purple-700 text-white font-extrabold py-4 rounded-2xl transition-all shadow-md active:scale-95 text-md"
                        >
                          ✨ Create Default Hero Without Photo
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  // DISPLAY GENERATED HERO (PORTRAIT OR VIDEO)
                  <div className="flex flex-col items-center gap-6">
                    <div className="w-72 h-72 rounded-[40px] overflow-hidden border-8 border-purple-300 shadow-2xl bg-white relative animate-in zoom-in-50 duration-500">
                      {isGeneratingVideo ? (
                        <div className="absolute inset-0 bg-indigo-950/80 flex flex-col items-center justify-center p-4 text-center text-white z-30">
                          <div className="w-12 h-12 border-4 border-pink-400 border-t-transparent rounded-full animate-spin mb-4"></div>
                          <p className="font-extrabold text-sm animate-pulse">🎬 Veo 3.1 is animating Puck...</p>
                          <p className="text-[10px] text-white/80 mt-1">This will take about 15-20 seconds</p>
                        </div>
                      ) : null}
                      
                      {videoUrl ? (
                        <video src={videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                      ) : (
                        <img src={poseUrl || actionUrl || avatarUrl} className="w-full h-full object-cover" alt="Hero Portrait" />
                      )}
                    </div>
                    
                    <div className="text-center">
                      <h3 className="text-2xl font-black text-purple-950">Puck is Awake!</h3>
                      <p className="text-sm text-purple-900/85 font-semibold mt-1">Check out the fairytale look of your hero.</p>
                    </div>

                    {!videoUrl ? (
                      // STEP 2 ANIMATION
                      <div className="w-full border-t border-purple-100 pt-6 mt-2 text-left animate-in fade-in duration-500">
                        <button 
                          onClick={handleAnimatePuck}
                          disabled={isGeneratingVideo || isGeneratingAvatar}
                          className="w-full bg-pink-600 hover:bg-pink-700 text-white font-extrabold py-4 rounded-2xl transition-all shadow-md active:scale-95 text-md flex items-center justify-center gap-2"
                        >
                          🎬 Animate Puck (Veo 3.1)
                        </button>
                      </div>
                    ) : (
                      // STEP 3 MUSIC THEME
                      <div className="w-full border-t border-purple-100 pt-6 mt-2 text-left animate-in fade-in duration-500">
                        <div className="grid grid-cols-2 gap-3 mb-6">
                          {[
                            { id: 'forest', icon: '🌲', label: 'Forest Flute', desc: 'Whimsical flutes & chirping birds' },
                            { id: 'sorcerer', icon: '✨', label: 'Sorcerer Synth', desc: 'Celestial magical chime chords' },
                            { id: 'harp', icon: '🎵', label: 'Golden Harp', desc: 'Royal palace harp & woodwinds' },
                            { id: 'march', icon: '🥁', label: 'Heroic March', desc: 'Brave horn marching tune' }
                          ].map(theme => (
                            <button
                              key={theme.id}
                              onClick={() => handleGenerateMusic(theme.id as any)}
                              disabled={isGeneratingMusic}
                              className={`p-4 rounded-3xl border-2 transition-all flex flex-col items-center text-center ${
                                selectedMusicTheme === theme.id && backgroundMusicUrl 
                                  ? 'bg-white border-purple-500 shadow-md scale-105' 
                                  : 'bg-white/40 border-transparent hover:bg-white/60'
                              } disabled:opacity-50`}
                            >
                              <span className="text-3xl mb-1">{theme.icon}</span>
                              <span className="text-sm font-black text-purple-950">{theme.label}</span>
                              <span className="text-[10px] text-purple-900/85 font-bold leading-tight mt-1">{theme.desc}</span>
                            </button>
                          ))}
                        </div>

                        {isGeneratingMusic && (
                          <div className="flex flex-col items-center gap-4 py-4 text-center">
                            <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-purple-900 font-extrabold text-sm animate-pulse">
                              🎵 Lyria 3 is composing Puck's theme...
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {videoUrl && backgroundMusicUrl && !isGeneratingMusic && (
                      <div className="w-full bg-purple-50/60 border border-purple-100 rounded-3xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 mt-2 mb-2 shadow-sm animate-in fade-in duration-300">
                        <div className="flex items-center gap-3 text-left">
                          <span className="text-3xl animate-pulse">🎵</span>
                          <div>
                            <p className="font-black text-purple-950 text-sm">Theme Song Ready!</p>
                            <p className="text-xs text-purple-900/85 font-bold">Listen to the custom fairytale tune.</p>
                          </div>
                        </div>
                        <audio 
                          src={backgroundMusicUrl} 
                          controls 
                          autoPlay
                          loop
                          className="h-10 w-full sm:w-60 accent-purple-600"
                        />
                      </div>
                    )}
                    
                    {videoUrl && backgroundMusicUrl && !isGeneratingMusic && (
                      // STEP 4 ENTER
                      <button 
                        onClick={() => setIsOnboarded(true)}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-black text-2xl py-5 rounded-[25px] transition-all shadow-lg hover:scale-[1.02] active:scale-95 mt-4 flex items-center justify-center gap-2 animate-in zoom-in-95 duration-300"
                      >
                        🚀 Enter the Fairytale World
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          // STORYTELLING MODE (normal columns)
          <>
            {/* Left Sidebar: Selectors & Mode Controls */}
            <div className="w-full lg:w-80 flex flex-col gap-6">
              <div className="glass-card rounded-[40px] p-6 shadow-xl bg-white/60 border border-white/50 backdrop-blur-md flex flex-col gap-6 flex-1 animate-in slide-in-from-left-8 duration-500">
                <ModeSelector
                  selected={storyMode}
                  onChange={setStoryMode}
                  disabled={connectionStatus === 'Connected' || isAgentLoading}
                />

                <ExerciseModeSelector
                  selected={exerciseMode}
                  onChange={setExerciseMode}
                  disabled={connectionStatus === 'Connected'}
                />

                {/* Agent Mode: Loading / Ready state */}
                {storyMode === 'agent' && (
                  <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-4">
                    {isAgentLoading && (
                      <div className="flex items-center gap-3">
                        <div className="w-5 h-5 border-4 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                        <p className="text-sm font-medium text-blue-700">{agentProgress || 'Preparing story...'}</p>
                      </div>
                    )}
                    {!isAgentLoading && storyText && (
                      <div className="space-y-2">
                        <p className="text-sm font-bold text-green-700 flex items-center gap-2">✨ Story ready!</p>
                        <p className="text-xs text-gray-600 line-clamp-3 italic">{storyText.slice(0, 180)}...</p>
                        <button
                          onClick={connect}
                          disabled={connectionStatus === 'Connected'}
                          className="w-full mt-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md disabled:opacity-50"
                        >
                          🧚 Wake Puck!
                        </button>
                      </div>
                    )}
                    {!isAgentLoading && agentError && (
                      <div className="space-y-2">
                        <p className="text-sm font-bold text-red-600">⚠️ {agentError}</p>
                        <button onClick={() => fetchStory()} className="text-xs text-blue-600 underline">Try again</button>
                      </div>
                    )}
                    {!isAgentLoading && !storyText && !agentError && (
                      <button
                        onClick={() => fetchStory()}
                        className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md"
                      >
                        🚀 Generate Story with Agents
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Middle Column: Main Story Player */}
            <div className="flex-1 flex flex-col gap-6">
              <div className="glass-card rounded-[40px] overflow-hidden flex-1 shadow-xl flex flex-col relative min-h-[400px] bg-white/60 border border-white/50 backdrop-blur-md">
                <div className="flex-1 bg-white/20 flex items-center justify-center relative">
                  {videoUrl ? (
                    <video src={videoUrl || undefined} autoPlay loop muted playsInline className="w-full h-full object-cover animate-in fade-in duration-1000" />
                  ) : currentIllustration ? (
                    <img src={currentIllustration || undefined} className="w-full h-full object-cover animate-in fade-in duration-1000" alt="Story Scene" />
                  ) : (actionUrl || avatarUrl) ? (
                    <img src={actionUrl || avatarUrl || undefined} className="w-full h-full object-cover animate-in fade-in duration-1000" alt="Puck" />
                  ) : (
                    <div className="text-center p-12 space-y-6">
                      {appState === 'IDLE' ? (
                        <div className="text-purple-800/80 font-bold text-center">Connect and start media below to begin the magic.</div>
                      ) : (
                        <div className="flex flex-col items-center gap-6">
                          <div className="w-20 h-20 border-8 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                          <p className="text-purple-600 text-xl font-black">Story is active...</p>
                        </div>
                      )}
                    </div>
                  )}

                  {storyChoices.length > 0 && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center p-12 bg-black/30 backdrop-blur-[2px]">
                      <div className="flex flex-col md:flex-row gap-6 w-full max-w-3xl">
                        {storyChoices.map((choice, i) => (
                          <button key={i} onClick={() => selectChoice(choice)} className="flex-1 bg-white/95 hover:bg-yellow-400 hover:scale-105 active:scale-95 transition-all p-8 rounded-3xl shadow-2xl border-4 border-purple-400 text-xl font-black text-purple-900">
                            {choice}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div 
                  ref={storyContainerRef}
                  className="bg-white/95 h-48 p-8 border-t border-white/50 backdrop-blur-xl overflow-y-auto scroll-smooth flex-shrink-0"
                >
                  {accumulatedStory.length === 0 && !aiTranscription ? (
                    <p className="text-purple-800/70 font-semibold italic text-center text-xl">
                      {appState === 'STORYTELLING' ? "The magic is unfolding..." : "Your story awaits"}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {accumulatedStory.map((turn, i) => (
                        <p key={i} className="text-purple-950 text-xl font-medium leading-relaxed italic">
                          {formatStoryText(turn)}
                        </p>
                      ))}
                      {aiTranscription && (
                        <p className="text-purple-600 text-xl font-extrabold leading-relaxed italic">
                          {formatStoryText(aiTranscription)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Sidebar: Camera, Energy, Achievements */}
            <div className="w-full lg:w-80 flex flex-col gap-6">
              <div className={`glass-card rounded-[40px] overflow-hidden aspect-square relative shadow-xl bg-indigo-950 border-4 transition-all duration-500 ${isUserSpeaking ? 'border-pink-400 scale-[1.02]' : 'border-white/20'}`}>
                <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover transform -scale-x-100 transition-opacity duration-1000 ${isCameraActive ? 'opacity-80' : 'opacity-0'}`} />
                
                {!isCameraActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20">
                    <span className="text-6xl mb-4">📷</span>
                    <span className="font-black text-xs uppercase tracking-tighter">Camera Off</span>
                  </div>
                )}
                <div className="absolute bottom-6 left-6 bg-black/60 px-4 py-2 rounded-full flex items-center gap-3 backdrop-blur-md">
                  <div className={`w-3 h-3 rounded-full ${isCameraActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                  <span className="text-white text-[12px] font-black tracking-widest uppercase">{isUserSpeaking ? "User Speaking" : "AI Storytelling"}</span>
                </div>
                
                {/* Movement Glow Overlay */}
                {lastMovement && (
                  <div className="absolute inset-0 bg-yellow-400/20 animate-pulse border-8 border-yellow-400 rounded-[40px] pointer-events-none flex items-center justify-center">
                    <div className="bg-yellow-400 text-purple-900 px-6 py-2 rounded-full font-black text-xl shadow-2xl animate-bounce">
                      +{lastMovement.energy} ENERGY!
                    </div>
                  </div>
                )}
              </div>

              {/* Heroic Energy Dashboard (Phase 1 Movement Metrics) */}
              <div className="glass-card rounded-[40px] p-6 shadow-xl bg-gradient-to-br from-yellow-50 to-orange-50 border-2 border-yellow-200">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-black text-orange-800 flex items-center gap-2"><span className="text-2xl">🔥</span> Heroic Energy</h3>
                  <span className="text-2xl font-black text-orange-600">{heroicEnergy}%</span>
                </div>
                <div className="w-full bg-orange-200/50 h-6 rounded-full overflow-hidden p-1 border border-orange-200">
                  <div 
                    className="h-full bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full transition-all duration-1000 ease-out shadow-inner"
                    style={{ width: `${heroicEnergy}%` }}
                  />
                </div>
                <p className="text-[10px] text-orange-700/60 font-bold uppercase tracking-widest mt-3 text-center">Movement is the key to the magic</p>
              </div>

              <div className="glass-card rounded-[40px] p-6 flex-1 shadow-inner bg-white/60 overflow-y-auto border border-white/50 backdrop-blur-md">
                <h3 className="text-lg font-black text-purple-800 mb-4 flex items-center gap-2"><span className="text-2xl">🏺</span> Achievements</h3>
                <div className="grid grid-cols-2 gap-3">
                  {achievements.map(ach => (
                    <div key={ach.id} className={`p-3 rounded-2xl border-2 transition-all flex flex-col items-center text-center ${ach.unlocked ? 'bg-white border-yellow-300 shadow-md' : 'bg-gray-200/40 border-transparent grayscale opacity-40'}`}>
                      <span className="text-4xl mb-1">{ach.icon}</span>
                      <span className="text-[10px] font-black text-gray-800 uppercase tracking-tighter leading-tight">{ach.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* --- FOOTER --- */}
      <footer className="w-full max-w-[1600px] border-t border-purple-100/50 pt-6 pb-2 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-semibold text-purple-900/60 animate-in fade-in duration-1000">
        <p>© 2026 Developed by <a href="https://github.com/vero-code" target="_blank" rel="noopener noreferrer" className="text-purple-800 underline hover:text-purple-950 transition-colors">Veronika Kashtanova</a></p>
        <p>🪄 Crafted with Google Gemini, ADK, Cloud Run, Veo & Lyria. Let your imagination soar!</p>
      </footer>



    </div>
  );
};

export default App;
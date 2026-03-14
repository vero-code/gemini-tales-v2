import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import type { AppState, Achievement, StoryMode } from './types';
import { GeminiLiveAPI, FunctionCallDefinition } from './utils/geminilive';
import { AudioStreamer, VideoStreamer, AudioPlayer } from './utils/mediaUtils';
import { SYSTEM_INSTRUCTION, AGENT_SYSTEM_INSTRUCTION, INITIAL_ACHIEVEMENTS } from './config';
import { ModeSelector } from './components/ModeSelector';
import { useAgentStory } from './hooks/useAgentStory';
import BiometricLock from './components/BiometricLock';

// --- ENV VARIABLES ---
const PROJECT_ID = import.meta.env.VITE_PROJECT_ID || import.meta.env.VITE_GCP_PROJECT;
// Auto-detect proxy URL if it points to localhost or is missing (useful for Cloud Run)
const rawProxyUrl = import.meta.env.VITE_PROXY_URL;
const PROXY_URL = rawProxyUrl 
  ? rawProxyUrl 
  : (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/proxy';

const MODEL_ID = import.meta.env.VITE_MODEL_ID;
const MODEL_ID_IMAGE = import.meta.env.VITE_MODEL_ID_IMAGE;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

if (!PROJECT_ID || !MODEL_ID || !MODEL_ID_IMAGE || !GEMINI_API_KEY) {
  throw new Error('Missing required environment variables (PROJECT_ID, MODEL_ID, etc.)');
}



class GenerateIllustrationTool extends FunctionCallDefinition {
  callback: (prompt: string) => void;
  constructor(callback: (prompt: string) => void) {
    super(
      "generateIllustration",
      "Generates a watercolor style illustration.",
      { type: "object", properties: { prompt: { type: "string" } } },
      ["prompt"]
    );
    this.callback = callback;
  }
  functionToCall(parameters: any) { this.callback(parameters.prompt); }
}

class AwardBadgeTool extends FunctionCallDefinition {
  callback: (badgeId: string) => void;
  constructor(callback: (badgeId: string) => void) {
    super(
      "awardBadge",
      "Awards a specific badge to the child.",
      { 
        type: "object", 
        properties: { 
          badgeId: { 
            type: "string", 
            enum: ['bunny_hop', 'wizard_wave', 'curious_explorer', 'graceful_leaf', 'story_lover'],
            description: "The unique ID of the badge to award."
          } 
        } 
      },
      ["badgeId"]
    );
    this.callback = callback;
  }
  functionToCall(parameters: any) { this.callback(parameters.badgeId); }
}

class ShowChoiceTool extends FunctionCallDefinition {
  callback: (options: string[]) => void;
  constructor(callback: (options: string[]) => void) {
    super(
      "showChoice",
      "Shows a set of choice buttons for the child to choose the next step in the story.",
      { 
        type: "object", 
        properties: { 
          options: { 
            type: "array", 
            items: { type: "string" },
            description: "A list of 2-3 short choices for the child."
          } 
        } 
      },
      ["options"]
    );
    this.callback = callback;
  }
  functionToCall(parameters: any) { this.callback(parameters.options); }
}

class TriggerBiometricTool extends FunctionCallDefinition {
  callback: () => void;
  constructor(callback: () => void) {
    super(
      "triggerBiometric",
      "Triggers the biometric hand scanner on the user's device. MUST call this when asking for the child to scan their hand.",
      { type: "object", properties: {} },
      []
    );
    this.callback = callback;
  }
  functionToCall() { this.callback(); }
}

const App: React.FC = () => {
  // --- STORY STATE ---
  const [appState, setAppState] = useState<AppState | 'IDLE' | 'STARTING' | 'STORYTELLING' | 'ERROR'>('IDLE');
  const [currentIllustration, setCurrentIllustration] = useState<string | null>(null);
  const [aiTranscription, setAiTranscription] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [achievements, setAchievements] = useState<Achievement[]>(INITIAL_ACHIEVEMENTS);
  const [lastAwarded, setLastAwarded] = useState<Achievement | null>(null);
  const [storyChoices, setStoryChoices] = useState<string[]>([]);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [accumulatedStory, setAccumulatedStory] = useState('');

  // --- MODE STATE ---
  const [storyMode, setStoryMode] = useState<StoryMode>('live');
  const { fetchStory, storyText, isLoading: isAgentLoading, progress: agentProgress, error: agentError, reset: resetAgentStory } = useAgentStory();

  const [characterDescription, setCharacterDescription] = useState('a small woodland elf with translucent wings and a twig wand');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [actionUrl, setActionUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [isGeneratingAction, setIsGeneratingAction] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);

  // --- DEV PANEL STATE ---
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedCamera, setSelectedCamera] = useState('');
  const [isAudioOn, setIsAudioOn] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [chatMessages, setChatMessages] = useState<{sender: string, text: string, type: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [debugInfo, setDebugInfo] = useState('Application initialized...\n');
  const [showBiometricLock, setShowBiometricLock] = useState(false);
  const [pendingBiometricId, setPendingBiometricId] = useState<string | null>(null);

  // --- REFS ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const storyContainerRef = useRef<HTMLDivElement>(null);
  
  const liveClientRef = useRef<GeminiLiveAPI | null>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const videoStreamerRef = useRef<VideoStreamer | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);

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
    console.log(`[DEBUG] ${msg}`);
    setDebugInfo(prev => `${msg}\n${prev}`.slice(0, 1500));
  };
  
  const appendChat = (sender: string, text: string, type: string) => {
    setChatMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.sender === sender && type === 'transcript') {
        const newArr = [...prev];
        newArr[newArr.length - 1] = {
           ...last,
           text: last.text + text
        };
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
    try {
      const backendUrl = PROXY_URL.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws/')[0];
      const response = await fetch(`${backendUrl}/api/avatar/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: characterDescription })
      });
      const data = await response.json();
      if (data.path) {
        const fullPath = backendUrl + data.path;
        setAvatarUrl(fullPath);
        // Also set as current illustration if we want to see it big
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
    
    try {
      const backendUrl = PROXY_URL.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws/')[0];
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('description', characterDescription);
      
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

  const handleAnimatePuck = async () => {
    if (!characterDescription) return;
    setIsGeneratingVideo(true);
    setVideoUrl(null);
    logDebug("🌿 Sending Puck to the Animation Studio (Veo 3.1)...");
    try {
      const backendUrl = PROXY_URL.replace('ws://', 'http://').replace('wss://', 'https://').split('/ws/')[0];
      const response = await fetch(`${backendUrl}/api/avatar/animate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: characterDescription })
      });
      const data = await response.json();
      if (data.path) {
        setVideoUrl(backendUrl + data.path);
        logDebug("✓ Puck is ALIVE! Animation complete.");
      }
    } catch (err) {
      logDebug("Failed to animate Puck: " + err);
    } finally {
      setIsGeneratingVideo(false);
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
    logDebug("Connecting to ADK Search Agent...");

    try {
        const sessionId = Math.random().toString(36).substring(7);
        const baseUrl = PROXY_URL.split('/ws/proxy')[0]; 
        const adkUrl = `${baseUrl}/ws/search_live/user1/${sessionId}`;

        console.log("Starting connection to ADK:", adkUrl);
        logDebug(`Target URL: ${adkUrl}`);

        const client = new GeminiLiveAPI(adkUrl, PROJECT_ID, MODEL_ID);
        client.useADK = true;
        liveClientRef.current = client;

        // Backend ADK agent handles voice, instructions and modalities.
        // We only need to tell the client to expect/send transcriptions.
        client.inputAudioTranscription = true;
        client.outputAudioTranscription = true;

        // From Python-server through WebSocket.
        client.onReceiveResponse = async (message: any) => {
            console.log("Received message:", message);
            if (!message) return;

            const msgType = String(
                message.type || 
                (message.setupComplete ? 'SETUP_COMPLETE' : '') ||
                (message.serverContent?.turnComplete ? 'TURN_COMPLETE' : '') ||
                ''
            ).toUpperCase().replace(" ", "_");
            
            if (!msgType) return;
            
            logDebug(`📨 Received: ${msgType}`);
            
            if (msgType === 'SETUP_COMPLETE') {
              setConnectionStatus('Connected');
              setAppState('STORYTELLING');
              appendChat("SYSTEM", "Setup Complete. Ready!", "system");
              logDebug("Setup complete! Magic is starting.");
            } else if (msgType === 'OUTPUT_TRANSCRIPTION') {
                if (!message.data?.finished) {
                    const delta = message.data.text;
                    setAiTranscription(prev => prev + delta);
                    setAccumulatedStory(prev => {
                        if (prev && !prev.endsWith(' ') && !prev.endsWith('\n') && !delta.startsWith(' ')) {
                            return prev + ' ' + delta;
                        }
                        return prev + delta;
                    });
                    appendChat("GEMINI", delta, "transcript");
                }
            } else if (msgType === 'AUDIO') {
                const audioLen = message.data?.length || 0;
                logDebug(`🎙️ AUDIO: Received ${audioLen} bytes of voice data`);
    
                if (!audioPlayerRef.current) {
                    logDebug("❌ ERROR: AudioPlayer is NULL! Cannot play.");
                    return;
                }
                
                if (!audioPlayerRef.current.isInitialized) {
                    logDebug("🔄 AudioPlayer needs init, attempting...");
                    await audioPlayerRef.current.init();
                }
                
                try {
                    logDebug("🎵 Feeding audio to player queue...");
                    await audioPlayerRef.current.play(message.data);
                    logDebug("✅ Audio chunk played successfully");
                } catch (err) {
                    logDebug(`❌ Playback error: ${err}`);
                }
            } else if (msgType === 'TURN_COMPLETE') {
                logDebug("🏁 TURN_COMPLETE: Gemini finished this sentence.");
                setAiTranscription('');
                setIsUserSpeaking(false);
            } else if (msgType === 'INTERRUPTED') {
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
                
                // functionCalls.forEach((fc: any) => {
                //    logDebug(`Calling tool: ${fc.name}`);
                   
                //    let resultMsg = "Success";
                //    if (fc.name === 'generateIllustration') {
                //        generateNewIllustration(fc.args.prompt);
                //    } else if (fc.name === 'awardBadge') {
                //        handleAwardBadge(fc.args.badgeId);
                //    } else if (fc.name === 'showChoice') {
                //        setStoryChoices(fc.args.options);
                //    } else if (fc.name === 'triggerBiometric') {
                //        setPendingBiometricId(fc.id);
                //        setShowBiometricLock(true);
                //    }
                   
                //    // Respond immediately for everything EXCEPT triggerBiometric
                //    if (fc.name !== 'triggerBiometric' && liveClientRef.current) {
                //        const correctPayload = {
                //            tool_response: {
                //                function_responses: [
                //                    {
                //                        id: fc.id,
                //                        response: { result: resultMsg }
                //                    }
                //                ]
                //            }
                //        };
                //        logDebug(`📤 Sending tool response for ${fc.name}...`);
                //        liveClientRef.current.sendMessage(correctPayload);
                //    }
                // });
            }
        };

        client.onConnectionStarted = () => {
            logDebug("🔌 WebSocket: Socket Opened! Waiting for SETUP_COMPLETE...");
        };

        client.onErrorMessage = (err: any) => {
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
    setAccumulatedStory('');
    setAiTranscription('');
    resetAgentStory();
    logDebug("Disconnected from Gemini.");
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
      } catch (err: any) { logDebug("Audio error: " + err); }
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
      } catch (err: any) { logDebug("Video error: " + err); }
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
    <div className="min-h-screen flex flex-col items-center p-4 md:p-8 space-y-8 overflow-y-auto bg-[#faf7f2] font-sans">
      
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
      <header className="text-center z-10 w-full max-w-7xl">
        <h1 className="text-5xl md:text-7xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">Gemini Tales</h1>
        <p className="text-xl text-gray-500 mt-2 font-medium italic">A magical world where stories come to life!</p>
      </header>

      {/* --- MAIN STORY EXPERIENCE (Beautiful UI) --- */}
      <main className="w-full max-w-7xl flex flex-col lg:flex-row gap-8 z-10">
        <div className="flex-1 flex flex-col gap-6">
          <div className="glass-card rounded-[40px] overflow-hidden flex-1 shadow-xl flex flex-col relative min-h-[400px] bg-white/60 border border-white/50 backdrop-blur-md">
            <div className="flex-1 bg-white/20 flex items-center justify-center relative">
              {videoUrl ? (
                <video src={videoUrl} autoPlay loop muted className="w-full h-full object-cover animate-in fade-in duration-1000" />
              ) : currentIllustration ? (
                <img src={currentIllustration} className="w-full h-full object-cover animate-in fade-in duration-1000" alt="Story Scene" />
              ) : (
                <div className="text-center p-12 space-y-6">
                  {appState === 'IDLE' ? (
                    <div className="text-gray-400 font-medium">Connect and start media below to begin the magic.</div>
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
              <p className="text-purple-950 text-2xl font-medium leading-relaxed italic text-center">
                {formatStoryText(accumulatedStory || aiTranscription) || (appState === 'STORYTELLING' ? "The magic is brewing..." : "Your story awaits")}
              </p>
            </div>
          </div>
        </div>

        <div className="w-full lg:w-96 flex flex-col gap-6">
          <div className={`glass-card rounded-[40px] overflow-hidden aspect-square relative shadow-xl bg-indigo-950 border-4 transition-all duration-500 ${isUserSpeaking ? 'border-pink-400 scale-[1.02]' : 'border-white/20'}`}>
            <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover transform -scale-x-100 transition-opacity duration-1000 ${isCameraActive ? 'opacity-80' : 'opacity-0'}`} />
            
            {showBiometricLock && (
              <BiometricLock videoRef={videoRef as React.RefObject<HTMLVideoElement>} onUnlock={() => {
                  setShowBiometricLock(false);
                  appendChat("SYSTEM", "Biometric verification successful!", "system");
                  
                  if (pendingBiometricId && liveClientRef.current) {
                      const payload = {
                          tool_response: {
                              function_responses: [
                                  {
                                      id: pendingBiometricId,
                                      response: { result: "Success: The biometric verification passed." }
                                  }
                              ]
                          }
                      };
                      liveClientRef.current.sendMessage(payload);
                      setPendingBiometricId(null);
                  }
                  
                  if (liveClientRef.current) {
                      liveClientRef.current.sendTextMessage("[SYSTEM]: Biometric verification SUCCESSFUL. Proceed to PHASE 3.");
                  }
              }} />
            )}

            {!isCameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20">
                <span className="text-6xl mb-4">📷</span>
                <span className="font-black text-xs uppercase tracking-tighter">Camera Off</span>
              </div>
            )}
            <div className="absolute top-6 right-6">
               <button 
                  onClick={() => setShowBiometricLock(true)} 
                  className="bg-cyan-500/80 hover:bg-cyan-400 text-white px-3 py-1.5 rounded-full text-xs font-black tracking-widest uppercase shadow-lg border border-cyan-300 transition-all active:scale-95"
               >
                 Verify Biometrics
               </button>
            </div>
            <div className="absolute bottom-6 left-6 bg-black/60 px-4 py-2 rounded-full flex items-center gap-3 backdrop-blur-md">
               <div className={`w-3 h-3 rounded-full ${isCameraActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
               <span className="text-white text-[12px] font-black tracking-widest uppercase">{isUserSpeaking ? "User Speaking" : "AI Storytelling"}</span>
            </div>
          </div>

          <div className="glass-card rounded-[40px] p-6 flex-1 shadow-inner bg-white/60 overflow-y-auto max-h-[300px] border border-white/50 backdrop-blur-md">
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
      </main>

      {/* --- DEVELOPER CONTROL CENTER (The Google UI you requested) --- */}
      <section className="w-full max-w-7xl bg-white/80 backdrop-blur-xl border-2 border-purple-100 shadow-2xl rounded-[40px] p-8 z-10 flex flex-col lg:flex-row gap-8">
        
        {/* Connection & Media Settings */}
        <div className="flex-1 flex flex-col gap-6">
            {/* Mode Selector */}
            <ModeSelector
              selected={storyMode}
              onChange={setStoryMode}
              disabled={connectionStatus === 'Connected' || isAgentLoading}
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

            <div>
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">🔌 Connection</h3>
                <div className="flex gap-3 mb-4">
                    {/* Live Mode: direct connect. Agent Mode: show Wake Puck above, only Disconnect here */}
                    {storyMode === 'live' && (
                      <button onClick={connect} disabled={connectionStatus === 'Connected'} className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed">Connect API</button>
                    )}
                    <button onClick={disconnect} disabled={connectionStatus !== 'Connected'} className="bg-red-100 text-red-600 hover:bg-red-200 px-6 py-2 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed">Disconnect</button>
                </div>
                <div className="text-sm font-medium text-gray-600">
                    Status: <span className={connectionStatus === 'Connected' ? 'text-green-600 font-bold' : 'text-purple-600 font-bold'}>{connectionStatus}</span>
                </div>
            </div>

            <div className="space-y-4 bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Microphone</label>
                    <select className="w-full border border-gray-200 rounded-lg p-2 bg-white text-sm" value={selectedMic} onChange={e => setSelectedMic(e.target.value)}>
                        <option value="">Default Microphone</option>
                        {mics.map(m => <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Camera</label>
                    <select className="w-full border border-gray-200 rounded-lg p-2 bg-white text-sm" value={selectedCamera} onChange={e => setSelectedCamera(e.target.value)}>
                        <option value="">Default Camera</option>
                        {cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
                    </select>
                </div>
                <div className="flex gap-3 pt-2">
                    <button onClick={toggleAudio} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${isAudioOn ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                        {isAudioOn ? 'Stop Audio' : 'Start Audio'}
                    </button>
                    <button onClick={toggleVideo} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${isVideoOn ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                        {isVideoOn ? 'Stop Video' : 'Start Video'}
                    </button>
                </div>
            </div>

            {/* <div className="bg-yellow-50/50 p-4 rounded-2xl border border-yellow-100">
                <h4 className="text-xs font-bold text-yellow-700 uppercase mb-3">🛠️ Simulate Tools (Debug)</h4>
                <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => handleAwardBadge('bunny_hop')} className="bg-white border border-yellow-200 py-1.5 rounded-lg text-xs font-bold hover:bg-yellow-100 transition-all">Test 🐰 Badge</button>
                    <button onClick={() => handleAwardBadge('wizard_wave')} className="bg-white border border-yellow-200 py-1.5 rounded-lg text-xs font-bold hover:bg-yellow-100 transition-all">Test 🪄 Badge</button>
                    <button onClick={() => setStoryChoices(['Go to Cave', 'Stay at Camp'])} className="bg-white border border-yellow-200 py-1.5 rounded-lg text-xs font-bold hover:bg-yellow-100 transition-all col-span-2">Test Choices UI</button>
                </div>
            </div> */}
        </div>

        {/* Puck's Appearance Workshop & Chat Logs */}
        <div className="flex-1 flex flex-col gap-6">
            <div className="bg-purple-50/50 p-6 rounded-[30px] border-2 border-purple-200">
                <h3 className="text-lg font-black text-purple-800 mb-4 flex items-center gap-2">🧚 Customize Puck</h3>
                <div className="space-y-4">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-purple-600 uppercase">Puck's Appearance</label>
                        <input 
                            type="text" 
                            value={characterDescription} 
                            onChange={e => setCharacterDescription(e.target.value)}
                            placeholder="e.g. a small woodland elf with translucent wings..." 
                            className="bg-white border border-purple-200 rounded-xl p-3 text-sm focus:border-purple-500 outline-none"
                        />
                        <button 
                            onClick={handleCreateAvatar}
                            disabled={isGeneratingAvatar}
                            className={`w-full py-3 rounded-xl font-bold text-sm shadow-md transition-all ${isGeneratingAvatar ? 'bg-purple-200 text-purple-400' : 'bg-purple-600 text-white hover:bg-purple-700 active:scale-95'}`}
                        >
                            {isGeneratingAvatar ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                                    Painting Puck...
                                </span>
                            ) : "🎨 Bring Puck to Life"}
                        </button>
                        
                        <div className="flex gap-2">
                           <button 
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isGeneratingAvatar}
                              className="flex-1 py-2 rounded-xl font-bold text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-all border border-indigo-200"
                           >
                              📂 Upload Photo
                           </button>
                           <input 
                              type="file" 
                              ref={fileInputRef} 
                              className="hidden" 
                              accept="image/*" 
                              onChange={(e) => e.target.files?.[0] && handlePhotoUpload(e.target.files[0])} 
                           />
                        </div>
                    </div>

                    {avatarUrl && (
                        <div className="pt-4 border-t border-purple-100 animate-in slide-in-from-top-4">
                            <div className="mb-4 rounded-2xl overflow-hidden border-2 border-purple-200 shadow-sm aspect-square bg-white">
                                <img src={actionUrl || avatarUrl} alt="Avatar Preview" className="w-full h-full object-cover" />
                            </div>
                            <label className="text-xs font-bold text-purple-600 uppercase mb-2 block">Action (Maintaining Puck's look)</label>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => handleGenerateAction("the character is casting a magic spell with a wooden wand")}
                                    disabled={isGeneratingAction}
                                    className="flex-1 bg-white border border-purple-200 py-3 rounded-xl text-xs font-bold hover:bg-purple-100 transition-all disabled:opacity-50"
                                >
                                    🪄 Cast Magic
                                </button>
                                <button 
                                    onClick={() => handleGenerateAction("the character is running through a field of flowers")}
                                    disabled={isGeneratingAction}
                                    className="flex-1 bg-white border border-purple-200 py-3 rounded-xl text-xs font-bold hover:bg-purple-100 transition-all disabled:opacity-50"
                                >
                                    🏃 Run in Field
                                </button>
                            </div>
                            <button 
                                onClick={handleAnimatePuck}
                                disabled={isGeneratingVideo}
                                className={`w-full mt-3 py-3 rounded-xl font-bold text-sm shadow-md transition-all ${isGeneratingVideo ? 'bg-indigo-200 text-indigo-400' : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 active:scale-95'}`}
                            >
                                {isGeneratingVideo ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                                        Veo is animating Puck...
                                    </span>
                                ) : "✨ Bring Puck to Life (Animate Video)"}
                            </button>
                            {isGeneratingAction && (
                                <p className="text-[10px] text-purple-500 mt-2 text-center animate-pulse">Gemini is rendering the action...</p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div>
                <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2">💬 Chat Logs</h3>
                <div ref={chatContainerRef} className="border border-gray-200 bg-white rounded-xl h-[180px] overflow-y-auto p-4 space-y-2 shadow-inner text-sm">
                    {chatMessages.length === 0 && <div className="text-gray-400 italic">Connect to Gemini to start chatting...</div>}
                    {chatMessages.map((msg, i) => (
                        <div key={i} className="leading-tight">
                            <span className={`font-black text-[10px] px-2 py-0.5 mr-2 rounded text-white uppercase tracking-wider ${
                                msg.sender === 'SYSTEM' ? 'bg-red-500' : msg.sender === 'GEMINI' ? 'bg-blue-500' : 'bg-green-500'
                            }`}>{msg.sender}</span>
                            <span className={msg.type === 'transcript' ? 'italic text-gray-600' : 'text-gray-800 font-medium'}>{msg.text}</span>
                        </div>
                    ))}
                </div>
                <div className="flex gap-2 mt-2">
                    <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendText()} placeholder="Type message to Gemini..." className="flex-1 border border-gray-200 rounded-lg p-2 text-sm outline-none focus:border-purple-400" />
                    <button onClick={sendText} className="bg-gray-800 text-white px-4 rounded-lg text-sm font-bold hover:bg-gray-700 transition-colors">Send</button>
                </div>
            </div>

            <div>
                <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2">🐛 Debug Console</h3>
                <pre className="border border-gray-200 bg-gray-900 text-green-400 rounded-xl h-[120px] overflow-y-auto p-4 text-[11px] font-mono shadow-inner whitespace-pre-wrap">
                    {debugInfo}
                </pre>
            </div>
        </div>
      </section>

    </div>
  );
};

export default App;
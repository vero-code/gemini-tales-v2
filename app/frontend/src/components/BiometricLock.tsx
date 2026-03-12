import React, { useState, useEffect, useRef } from 'react';
import { useGeminiSocket } from '../hooks/useGeminiSocket';

const SEQUENCE_LENGTH = 4;
const ROUND_TIME = 65;

const generateSequence = () => {
    const nums = new Set<number>();
    while (nums.size < SEQUENCE_LENGTH) {
        nums.add(Math.floor(Math.random() * 5) + 1); // 1-5
    }
    return Array.from(nums);
};

export default function BiometricLock({ onUnlock }: { onUnlock?: () => void }) {
    const [sequence, setSequence] = useState<number[]>([]);
    const [inputProgress, setInputProgress] = useState<number[]>([]);
    const [status, setStatus] = useState<string>('IDLE'); // IDLE, SCANNING, SUCCESS, FAIL
    const [timeLeft, setTimeLeft] = useState(ROUND_TIME);

    useEffect(() => {
        if (status === 'SUCCESS') {
            const updateStatus = async () => {
                if (onUnlock) onUnlock();
                try {
                    console.log('[BiometricLock] Attempting to fetch config.json...');
                    let config = null;
                    try {
                        const configResponse = await fetch('/config.json');
                        if (configResponse.ok) {
                            config = await configResponse.json();
                        }
                    } catch (e) {
                        console.log('[BiometricLock] Error fetching config.json:', e);
                    }

                    if (config && config.participant_id && config.api_base) {
                        const response = await fetch(`${config.api_base}/participants/${config.participant_id}`);
                        if (!response.ok) return;

                        const data = await response.json();
                        const updatedData = { ...data, level_4_complete: true };

                        let labsCompleted = 0;
                        if (updatedData.level_1_complete) labsCompleted++;
                        if (updatedData.level_2_complete) labsCompleted++;
                        if (updatedData.level_3_complete) labsCompleted++;
                        if (updatedData.level_4_complete) labsCompleted++;
                        if (updatedData.level_5_complete) labsCompleted++;

                        const completion_percentage = labsCompleted * 20;
                        const patchPayload = {
                            level_3_complete: true,
                            completion_percentage: completion_percentage
                        };

                        await fetch(`${config.api_base}/participants/${config.participant_id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(patchPayload),
                        });
                    }
                } catch (err) {
                    console.log('Optional config not found or update failed:', err);
                }
            };
            updateStatus();
        }
    }, [status, onUnlock]);

    const videoRef = useRef<HTMLVideoElement>(null);
    const sessionId = useRef(Math.random().toString(36).substring(7)).current;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const proxyUrl = import.meta.env.VITE_PROXY_URL;
    let apiHost = window.location.host;
    if (import.meta.env.VITE_API_URL) {
        apiHost = new URL(import.meta.env.VITE_API_URL).host;
    } else if (proxyUrl) {
        apiHost = new URL(proxyUrl).host;
    } else {
        apiHost = 'localhost:8000';
    }
    const wsUrl = `${proxyUrl && proxyUrl.startsWith('wss') ? 'wss:' : protocol}//${apiHost}/ws/adk_live/user1/${sessionId}`;

    const { status: socketStatus, lastMessage, connect, disconnect, startStream, stopStream } = useGeminiSocket(wsUrl);

    const startRound = () => {
        const newSeq = generateSequence();
        setSequence(newSeq);
        setInputProgress([]);
        setTimeLeft(ROUND_TIME);
        setStatus('SCANNING');
        connect();
    };

    useEffect(() => {
        if (status === 'SCANNING') {
            if (videoRef.current) startStream(videoRef.current);
        } else if (status === 'SUCCESS' || status === 'FAIL') {
            stopStream();
            disconnect();
        }
    }, [status, startStream, stopStream, disconnect, videoRef]);

    useEffect(() => {
        let interval: number;
        if (status === 'SCANNING') {
            interval = window.setInterval(() => {
                setTimeLeft((t) => {
                    if (t <= 1) {
                        setStatus('FAIL');
                        return 0;
                    }
                    return t - 1;
                });
            }, 1000);
        }
        return () => window.clearInterval(interval);
    }, [status]);

    useEffect(() => {
        if (status !== 'SCANNING' || !lastMessage) return;

        if (lastMessage.type === 'DIGIT_DETECTED') {
            const detected = lastMessage.value;
            const targetIndex = inputProgress.length;
            const targetValue = sequence[targetIndex];

            if (detected === targetValue) {
                const newProgress = [...inputProgress, detected];
                setInputProgress(newProgress);

                if (newProgress.length === SEQUENCE_LENGTH) {
                    setStatus('SUCCESS');
                }
            }
        }
    }, [lastMessage, status, sequence, inputProgress]);

    const [permissionDenied, setPermissionDenied] = useState(false);
    const [initiationWarning, setInitiationWarning] = useState(false);

    const handleInitiateOverride = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            stream.getTracks().forEach(track => track.stop());

            setPermissionDenied(false);
            setInitiationWarning(true);
            startRound();

            setTimeout(() => {
                setInitiationWarning(false);
            }, 5000);
        } catch (err) {
            console.error("Camera permission denied:", err);
            setPermissionDenied(true);
        }
    };

    return (
        <div className="relative w-full h-screen bg-black overflow-hidden font-mono text-cyan-400 select-none">
            <video
                ref={videoRef}
                muted
                playsInline
                className={`absolute top-0 left-0 w-full h-full object-cover z-0 opacity-50 grayscale transition-all duration-1000 ${status === 'SUCCESS' ? 'grayscale-0 opacity-100 blur-sm' :
                    status === 'FAIL' ? 'grayscale opacity-20 blur-md' : ''
                    }`}
            />

            {status === 'SCANNING' && <div className="z-10 absolute inset-0 pointer-events-none bg-[radial-gradient(circle,transparent_20%,#000_120%)] mix-blend-overlay"></div>}

            {permissionDenied && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
                    <div className="text-center border border-red-500 p-10 rounded bg-red-950/20 shadow-xl">
                        <h1 className="text-4xl font-bold text-red-500 mb-4 animate-pulse">ACCESS DENIED</h1>
                        <p className="text-xl text-red-300 mb-8">BIOMETRIC SENSOR OFFLINE</p>
                        <button
                            onClick={() => setPermissionDenied(false)}
                            className="px-6 py-2 border border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-colors"
                        >
                            ACKNOWLEDGE
                        </button>
                    </div>
                </div>
            )}

            {initiationWarning && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="text-center max-w-2xl px-8">
                        <h1 className="text-4xl font-bold text-yellow-500 mb-6 animate-pulse">INITIALIZING NEURAL LINK...</h1>
                        <div className="text-xl text-yellow-200/80 mb-8 space-y-4 font-mono">
                            <p>ESTABLISHING SECURE CHANNEL.</p>
                        </div>
                    </div>
                </div>
            )}

            {status === 'SUCCESS' && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-green-900/40 backdrop-blur-sm">
                    <div className="text-center">
                        <h1 className="text-8xl font-black text-white drop-shadow-[0_0_30px_rgba(0,255,0,0.8)]">
                            NEURAL SYNC COMPLETE
                        </h1>
                        <button
                            onClick={handleInitiateOverride}
                            className="mt-12 px-8 py-3 bg-black/80 border border-green-500 text-green-500 hover:bg-green-500 hover:text-black transition-all"
                        >
                            RE-SYNC
                        </button>
                    </div>
                </div>
            )}

            {status === 'FAIL' && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-red-900/60 backdrop-blur-sm">
                    <div className="text-center">
                        <h1 className="text-9xl font-black text-red-600 drop-shadow-[0_0_50px_rgba(255,0,0,1)]">
                            CRITICAL FAIL
                        </h1>
                        <button
                            onClick={handleInitiateOverride}
                            className="mt-12 px-8 py-3 bg-black/80 border border-red-500 text-red-500 hover:bg-red-500 hover:text-black transition-all"
                        >
                            RETRY SEQUENCE
                        </button>
                    </div>
                </div>
            )}

            <div className={`relative z-20 flex flex-col items-center justify-between h-full py-10 px-4 transition-opacity duration-500 ${status !== 'SCANNING' && status !== 'IDLE' ? 'opacity-20 blur-sm' : 'opacity-100'}`}>
                <div className="w-full max-w-4xl flex justify-between items-center border-b-2 border-cyan-400/50 pb-4 bg-black/60 backdrop-blur-sm p-6 rounded-t-xl text-white">
                    <div>
                        <h2 className="text-4xl font-black tracking-[0.2em] mb-2">MISSION ALPHA</h2>
                        <h1 className="text-xl font-bold tracking-widest text-cyan-400">SECURITY PROTOCOL: LEVEL 5</h1>
                    </div>
                    <div className={`px-4 py-2 text-xl font-bold border ${status === 'IDLE' ? 'border-red-500 text-red-500' :
                        status === 'SCANNING' && socketStatus === 'CONNECTED' ? 'border-yellow-400 text-yellow-400' :
                            'border-red-600 text-red-600'
                        }`}>
                        {status === 'IDLE' && 'DISSOCIATED'}
                        {status === 'SCANNING' && (
                            socketStatus === 'CONNECTED' ? 'NEURAL SYNC INITIALIZED' : 'NEURAL LINK DROPPED // OFFLINE'
                        )}
                    </div>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center gap-12 w-full max-w-4xl">
                    {status === 'IDLE' && (
                        <button
                            onClick={handleInitiateOverride}
                            className="px-12 py-6 text-2xl font-bold border-2 border-cyan-400 text-cyan-400 hover:bg-cyan-400 hover:text-black transition-all"
                        >
                            INITIATE NEURAL SYNC
                        </button>
                    )}

                    {status === 'SCANNING' && (
                        <>
                            <div className="flex gap-6">
                                {sequence.map((num, idx) => {
                                    const isMatched = idx < inputProgress.length;
                                    return (
                                        <div key={idx} className={`w-24 h-32 flex items-center justify-center text-6xl font-bold border-4 rounded-lg transition-all duration-300 ${isMatched
                                            ? 'border-green-500 text-green-500 bg-green-500/10 scale-110'
                                            : 'border-cyan-400 text-cyan-400 bg-black/50'
                                            }`}>
                                            {num}
                                        </div>
                                    )
                                })}
                            </div>

                            <div className="text-center mt-8">
                                <p className="text-cyan-400/80 text-lg uppercase tracking-widest border border-cyan-400/30 px-6 py-2 rounded bg-black/40">
                                    Show Hand & Say <span className="font-bold text-white">"CALIBRATE"</span> / <span className="font-bold text-white">"SCAN"</span>
                                </p>
                            </div>
                        </>
                    )}
                </div>

                <div className="w-full max-w-4xl grid grid-cols-3 items-end text-cyan-400">
                    <div className="text-xl">SINGLE STAGE OPERATION</div>
                    <div className="flex justify-center">
                        {status === 'SCANNING' && (
                            <div className={`text-6xl font-black tabular-nums tracking-tighter ${timeLeft <= 10 ? 'text-red-500 animate-bounce' : 'text-white'}`}>
                                00:{timeLeft.toString().padStart(2, '0')}
                            </div>
                        )}
                    </div>
                    <div className="text-right text-xl">STATUS: {socketStatus}</div>
                </div>
            </div>
        </div>
    );
}

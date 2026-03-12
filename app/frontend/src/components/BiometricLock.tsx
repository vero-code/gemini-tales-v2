import React, { useState, useEffect, useRef } from 'react';
import { useGeminiSocket } from '../hooks/useGeminiSocket';

const SEQUENCE_LENGTH = 1;
const ROUND_TIME = 65;

const generateSequence = () => {
    return [3];
};

export default function BiometricLock({ onUnlock, videoRef }: { onUnlock?: () => void, videoRef: React.RefObject<HTMLVideoElement> }) {
    const [status, setStatus] = useState<string>('SCANNING'); // IDLE, SCANNING, SUCCESS, FAIL
    const sessionId = useRef(Math.random().toString(36).substring(7)).current;

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

    useEffect(() => {
        // Automatically start when rendered
        setStatus('SCANNING');
        connect();
    }, [connect]);

    useEffect(() => {
        if (status === 'SCANNING' && socketStatus === 'CONNECTED') {
            if (videoRef.current) startStream(videoRef.current);
        } else if (status === 'SUCCESS' || status === 'FAIL') {
            stopStream();
            disconnect();
        }
    }, [status, socketStatus, startStream, stopStream, disconnect, videoRef]);

    useEffect(() => {
        if (status !== 'SCANNING' || !lastMessage) return;

        if (lastMessage.type === 'DIGIT_DETECTED') {
            const detected = lastMessage.value;
            if (detected === 3) {
                 setStatus('SUCCESS');
            }
        }
    }, [lastMessage, status]);

    if (status !== 'SCANNING') return null;

    return (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] rounded-[30px] overflow-hidden pointer-events-none">
            <div className="border-2 border-cyan-400/50 bg-black/60 px-6 py-4 rounded-xl flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                <h3 className="text-cyan-400 font-bold uppercase tracking-widest text-sm animate-pulse">
                    BIOMETRIC SCAN
                </h3>
                <p className="text-white text-xs">Waiting for 3 fingers...</p>
            </div>
            {socketStatus !== 'CONNECTED' && (
                <div className="absolute bottom-4 text-xs text-yellow-400 font-bold bg-black/50 px-3 py-1 rounded">
                    Connecting to sensor: {socketStatus}...
                </div>
            )}
        </div>
    );
}

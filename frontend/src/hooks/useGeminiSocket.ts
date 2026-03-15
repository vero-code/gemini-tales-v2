import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioStreamer } from '../utils/audioStreamer';
import { AudioRecorder } from '../utils/audioRecorder';

export function useGeminiSocket(url: string) {
    const [status, setStatus] = useState<string>('DISCONNECTED');
    const [lastMessage, setLastMessage] = useState<{ type: string; value: any } | null>(null);
    const ws = useRef<WebSocket | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const intervalRef = useRef<number | null>(null);
    const audioStreamer = useRef(new AudioStreamer(24000));
    const audioRecorder = useRef(new AudioRecorder(16000));

    const connect = useCallback(() => {
        if (ws.current?.readyState === WebSocket.OPEN) return;

        ws.current = new WebSocket(url);

        ws.current.onopen = () => {
            // console.log('Connected to Gemini Socket');
            setStatus('CONNECTED');
        };

        ws.current.onclose = () => {
            // console.log('Disconnected from Gemini Socket');
            setStatus('DISCONNECTED');
            stopStream();
        };

        ws.current.onerror = (err) => {
            // console.error('Socket error:', err);
            setStatus('ERROR');
        };

        ws.current.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);

                let parts: any[] = [];
                if (msg.serverContent?.modelTurn?.parts) {
                    parts = msg.serverContent.modelTurn.parts;
                } else if (msg.content?.parts) {
                    parts = msg.content.parts;
                }

                if (parts.length > 0) {
                    parts.forEach(part => {
                        if (part.functionCall) {
                            if (part.functionCall.name === 'report_digit') {
                                const count = parseInt(part.functionCall.args.count, 10);
                                setLastMessage({ type: 'DIGIT_DETECTED', value: count });
                            }
                        }

                        if (part.inlineData && part.inlineData.data) {
                            audioStreamer.current.resume();
                            audioStreamer.current.addPCM16(part.inlineData.data);
                        }
                    });
                }
            } catch (e) {
                // console.error('Failed to parse message', e, event.data.slice(0, 100));
            }
        };
    }, [url]);

    const stopStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current = null;
        }
        audioRecorder.current.stop();

        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const startStream = useCallback(async (videoElement: HTMLVideoElement) => {
        try {
            // Use the video element directly. It should already be playing.
            streamRef.current = videoElement.srcObject as MediaStream;

            try {
                let packetCount = 0;
                await audioRecorder.current.start((base64Audio) => {
                    if (ws.current?.readyState === WebSocket.OPEN) {
                        packetCount++;
                        ws.current.send(JSON.stringify({
                            type: 'audio',
                            data: base64Audio,
                            sampleRate: 16000
                        }));
                    }
                });
                // console.log("Microphone recording started");
            } catch (authErr) {
                // console.error("Microphone access denied or error:", authErr);
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const width = 640;
            const height = 480;
            canvas.width = width;
            canvas.height = height;

            intervalRef.current = window.setInterval(() => {
                if (ws.current?.readyState === WebSocket.OPEN && ctx) {
                    ctx.drawImage(videoElement, 0, 0, width, height);
                    const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
                    ws.current.send(JSON.stringify({
                        type: 'image',
                        data: base64,
                        mimeType: 'image/jpeg'
                    }));
                }
            }, 500);
        } catch (err) {
            // console.error('Error accessing camera:', err);
        }
    }, []);

    useEffect(() => {
        return () => {
            stopStream();
            if (ws.current) ws.current.close();
        };
    }, [stopStream]);

    const disconnect = useCallback(() => {
        if (ws.current) {
            ws.current.close();
            ws.current = null;
        }
        setStatus('DISCONNECTED');
        stopStream();
    }, [stopStream]);

    return { status, lastMessage, connect, disconnect, startStream, stopStream };
}

export class AudioStreamer {
    private context: AudioContext;
    private audioQueue: Float32Array[];
    private isPlaying: boolean;
    private sampleRate: number;

    constructor(sampleRate: number = 24000) {
        this.context = new (window.AudioContext || (window as any).webkitAudioContext)({
            sampleRate: sampleRate,
        });
        this.audioQueue = [];
        this.isPlaying = false;
        this.sampleRate = sampleRate;
    }

    public addPCM16(base64Data: string): void {
        try {
            const cleaned = base64Data.replace(/-/g, '+').replace(/_/g, '/');
            const raw = atob(cleaned);
            const rawLength = raw.length;
            const array = new Int16Array(new ArrayBuffer(rawLength));

            for (let i = 0; i < rawLength / 2; i++) {
                const lower = raw.charCodeAt(i * 2);
                const upper = raw.charCodeAt(i * 2 + 1);
                let sample = (upper << 8) | lower;
                if (sample & 0x8000) {
                    sample = sample - 0x10000;
                }
                array[i] = sample;
            }

            const float32Data = new Float32Array(array.length);
            for (let i = 0; i < array.length; i++) {
                float32Data[i] = array[i] / 32768.0;
            }

            this.audioQueue.push(float32Data);
            this.playNext();
        } catch (e) {
            // console.error('[AudioStreamer] Error in addPCM16:', e);
        }
    }

    private async playNext(): Promise<void> {
        if (this.isPlaying || this.audioQueue.length === 0) {
            return;
        }

        if (this.context.state === 'suspended') {
            try {
                await this.context.resume();
            } catch (e) {
                // console.error("Failed to resume", e);
            }
        }

        try {
            this.isPlaying = true;
            const audioData = this.audioQueue.shift();
            if (!audioData) {
                this.isPlaying = false;
                return;
            }

            const buffer = this.context.createBuffer(1, audioData.length, this.sampleRate);
            buffer.getChannelData(0).set(audioData);

            const source = this.context.createBufferSource();
            source.buffer = buffer;
            source.connect(this.context.destination);
            source.onended = () => {
                this.isPlaying = false;
                this.playNext();
            };
            source.start();
        } catch (e) {
            // console.error('[AudioStreamer] Error in playNext:', e);
            this.isPlaying = false;
            this.playNext();
        }
    }

    public resume(): void {
        if (this.context.state === 'suspended') {
            this.context.resume();
        }
    }
}

/**
 * Builds the ffmpeg audio filter chain used for the HomeKit live stream.
 *
 * With no extra options this returns exactly the filter the plugin has always
 * used, so existing setups sound the same until a new option is turned on.
 */
export type NoiseReductionLevel = "off" | "light" | "medium" | "strong";
/** Keeps audio timestamps steady (stops the pcm_alaw jitter glitches). */
export declare const BASE_AUDIO_FILTER = "aresample=async=16000";
export declare const MIN_AUDIO_VOLUME = 10;
export declare const MAX_AUDIO_VOLUME = 1000;
export declare function normaliseVolume(volumePercent: unknown): number;
export declare function normaliseNoiseReduction(level: unknown): NoiseReductionLevel;
export declare function buildAudioFilter(volumePercent?: unknown, noiseReduction?: unknown): string;

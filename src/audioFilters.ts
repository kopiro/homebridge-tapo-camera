/**
 * Builds the ffmpeg audio filter chain used for the HomeKit live stream.
 *
 * With no extra options this returns exactly the filter the plugin has always
 * used, so existing setups sound the same until a new option is turned on.
 */

export type NoiseReductionLevel = "off" | "light" | "medium" | "strong";

/** Keeps audio timestamps steady (stops the pcm_alaw jitter glitches). */
export const BASE_AUDIO_FILTER = "aresample=async=16000";

export const MIN_AUDIO_VOLUME = 10;
export const MAX_AUDIO_VOLUME = 1000;

// Values tested against 8 kHz pcm_alaw audio, which is what Tapo cameras send.
// "light" follows the noise level as it changes; "medium" and "strong" use a
// fixed noise floor, which removes much more hiss but can thin out quiet voices.
const NOISE_FILTERS: Record<Exclude<NoiseReductionLevel, "off">, string[]> = {
  light: ["highpass=f=150", "lowpass=f=3800", "afftdn=nr=12:nf=-50:tn=1"],
  medium: ["highpass=f=200", "lowpass=f=3800", "afftdn=nr=24:nf=-40"],
  strong: ["highpass=f=200", "lowpass=f=3800", "afftdn=nr=30:nf=-35"],
};

// Evens out loud and quiet speech so a big volume boost doesn't just make
// shouting louder.
const COMPRESSOR = "acompressor=threshold=0.1:ratio=3:attack=5:release=150";

// Stops boosted audio from clipping (crackling). level=false keeps the limiter
// from adding its own gain on top of ours.
const LIMITER = "alimiter=limit=0.95:level=false";

export function normaliseVolume(volumePercent: unknown): number {
  const value = Number(volumePercent);
  if (!Number.isFinite(value) || value <= 0) {
    return 100;
  }
  return Math.min(MAX_AUDIO_VOLUME, Math.max(MIN_AUDIO_VOLUME, Math.round(value)));
}

export function normaliseNoiseReduction(level: unknown): NoiseReductionLevel {
  return level === "light" || level === "medium" || level === "strong"
    ? level
    : "off";
}

export function buildAudioFilter(
  volumePercent?: unknown,
  noiseReduction?: unknown
): string {
  const volume = normaliseVolume(volumePercent);
  const noise = normaliseNoiseReduction(noiseReduction);

  const filters = [BASE_AUDIO_FILTER];

  if (noise !== "off") {
    filters.push(...NOISE_FILTERS[noise]);
  }

  if (volume > 100) {
    filters.push(COMPRESSOR);
  }

  if (volume !== 100) {
    filters.push(`volume=${(volume / 100).toFixed(2)}`);
  }

  if (noise !== "off" || volume > 100) {
    filters.push(LIMITER);
  }

  // camera-ffmpeg splits its arguments on spaces, so the chain must not
  // contain any.
  return filters.join(",");
}

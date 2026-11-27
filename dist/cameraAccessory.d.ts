import { CameraPlatform } from "./cameraPlatform";
import { VideoConfig } from "homebridge-camera-ffmpeg/dist/configTypes";
import { NoiseReductionLevel } from "./audioFilters";
export type CameraConfig = {
    name: string;
    ipAddress: string;
    username: string;
    password: string;
    streamUser?: string;
    streamPassword?: string;
    pullInterval?: number;
    disableStreaming?: boolean;
    disableEyesToggleAccessory?: boolean;
    disableAlarmToggleAccessory?: boolean;
    disableNotificationsToggleAccessory?: boolean;
    disableMotionDetectionToggleAccessory?: boolean;
    disableLEDToggleAccessory?: boolean;
    enableFloodLightAccessory?: boolean;
    disableMotionSensorAccessory?: boolean;
    lowQuality?: boolean;
    rtspTransport?: "udp" | "tcp";
    videoMaxWidth?: number;
    videoMaxHeight?: number;
    videoMaxFPS?: number;
    videoForceMax?: boolean;
    videoMaxBitrate?: number;
    /** @deprecated misspelling of videoMaxBitrate, kept for configs that used it */
    videoMaxBirate?: number;
    videoPacketSize?: number;
    videoCodec?: string;
    videoConfig?: VideoConfig;
    eyesToggleAccessoryName?: string;
    alarmToggleAccessoryName?: string;
    notificationsToggleAccessoryName?: string;
    motionDetectionToggleAccessoryName?: string;
    ledToggleAccessoryName?: string;
    floodLightAccessoryName?: string;
    /** Percent. 100 = unchanged, 300 = three times louder. */
    audioVolume?: number;
    audioNoiseReduction?: NoiseReductionLevel;
    /** Re-encode with noise reduction and better encoder settings (uses more CPU). */
    videoEnhance?: boolean;
    enableMotionPresenceSensor?: boolean;
    motionPresenceSensorName?: string;
    enablePersonSensor?: boolean;
    personSensorName?: string;
    enableDoorbellSensor?: boolean;
    doorbellSensorName?: string;
    enableLightSensor?: boolean;
    lightSensorName?: string;
    /** Seconds a presence sensor stays on after the event ends. */
    presenceHoldTime?: number;
    /** Seconds between event-history checks (backup for person/doorbell). 0 = off. */
    eventPollInterval?: number;
    /** Seconds between checks of the camera's own light. */
    lightSensorPollInterval?: number;
};
export declare class CameraAccessory {
    private readonly platform;
    private readonly config;
    private readonly log;
    private readonly api;
    private readonly camera;
    private pullIntervalTick;
    private readonly accessory;
    private infoAccessory;
    private toggleAccessories;
    private cachedStatus;
    private isOffline;
    private motionSensorService;
    private motionPresenceSensor;
    private personSensor;
    private doorbellSensor;
    private lightSensor;
    private onvifPersonActive;
    private lastDoorbellPressAt;
    private detectionPoller;
    private lightPollTick;
    private lightCheckTimeout;
    private lightUnsupportedWarned;
    private unsubscribeDoorbell;
    private readonly randomSeed;
    constructor(platform: CameraPlatform, config: CameraConfig);
    private hasStreamCredentials;
    private isMotionSensorEnabled;
    /** ONVIF events are needed by the motion sensor and the new presence sensors. */
    private needsOnvif;
    private setupInfoAccessory;
    private setupToggleAccessory;
    private getVideoConfig;
    private setupCameraStreaming;
    private setupMotionSensorAccessory;
    /**
     * Adds the optional presence (occupancy) sensors. Services are added here,
     * before the accessory is published; the event sources start afterwards in
     * startPresenceSources(). Existing services and their IDs are not touched.
     */
    private setupPresenceSensors;
    private startPresenceSources;
    private stopPresenceSources;
    private connectOnvifPresence;
    private listenForDoorbell;
    private onDoorbellPress;
    private checkLight;
    private setupPolling;
    private getStatusAndNotify;
    setup(): Promise<void>;
}

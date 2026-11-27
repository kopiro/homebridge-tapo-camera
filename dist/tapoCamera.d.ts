import { Logging } from "homebridge";
import { CameraConfig } from "./cameraAccessory";
import { OnvifCamera } from "./onvifCamera";
import type { TAPOBasicInfo, TAPOCameraSetRequest, TAPODetectionEvent } from "./types/tapo";
export type Status = {
    eyes: boolean | undefined;
    alarm: boolean | undefined;
    notifications: boolean | undefined;
    motionDetection: boolean | undefined;
    led: boolean | undefined;
    floodLight: boolean | undefined;
};
export declare class TAPOCamera extends OnvifCamera {
    protected readonly log: Logging;
    protected readonly config: CameraConfig;
    private readonly kStreamPort;
    private readonly fetchAgent;
    private readonly hashedPassword;
    private readonly hashedSha256Password;
    private readonly hashedSha1Password;
    private passwordEncryptionMethod;
    private isSecureConnectionValue;
    private readonly cnonce;
    private lsk;
    private ivb;
    private seq;
    private stok;
    constructor(log: Logging, config: CameraConfig);
    private getUsername;
    private getHeaders;
    private getHashedPassword;
    private fetch;
    private generateEncryptionToken;
    getAuthenticatedStreamUrl(lowQuality?: boolean): string;
    private generateCnonce;
    private validateDeviceConfirm;
    refreshStok(loginRetryCount?: number): Promise<void>;
    isSecureConnection(): Promise<boolean>;
    private stokPromise;
    getStok(loginRetryCount?: number): Promise<string>;
    private getAuthenticatedAPIURL;
    encryptRequest(request: string): Buffer<ArrayBuffer>;
    private encryptPad;
    private decryptResponse;
    private encryptUnpad;
    private getTapoTag;
    private pendingAPIRequests;
    private apiRequest;
    static SERVICE_MAP: Record<keyof Status, (value: boolean) => TAPOCameraSetRequest>;
    setStatus(service: keyof Status, value: boolean): Promise<object | {
        msg_alarm: {
            chn1_msg_alarm_info: {
                light_type: "1";
                alarm_type: "1";
                alarm_mode: ["sound", "light"];
                enabled: "on" | "off";
            };
        };
    } | {
        lens_mask: {
            lens_mask_info: {
                enabled: "on" | "off";
            };
        };
    } | {
        msg_push: {
            chn1_msg_push_info: {
                notification_enabled: "on" | "off";
                rich_notification_enabled: "on" | "off";
            };
        };
    } | {
        motion_detection: {
            motion_det: {
                enabled: "on" | "off";
            };
        };
    } | {
        led: {
            config: {
                enabled: "on" | "off";
            };
        };
    } | {
        image: {
            switch: {
                force_wtl_state: "on" | "off";
            };
        };
    } | {
        image: {
            switch: {
                force_wtl_state: "on" | "off";
            };
        };
    } | {
        device_info: {
            basic_info: TAPOBasicInfo;
        };
    }>;
    getBasicInfo(): Promise<TAPOBasicInfo>;
    getStatus(): Promise<Status>;
    /** The white lamp status comes back as "on", "1" or 1 depending on firmware. */
    static isLampOn(status: unknown): boolean;
    /**
     * Is the camera's own light (spotlight / floodlight / white lamp) on right now?
     * Returns undefined if the camera doesn't support it or didn't answer.
     */
    getLightOn(): Promise<boolean | undefined>;
    /**
     * How many seconds the camera clock is behind this machine's clock.
     * Detection history uses the camera's clock, so we need this to ask for
     * "the last few seconds".
     */
    getClockOffsetSeconds(): Promise<number | undefined>;
    /**
     * Detection history between two times (camera clock, in seconds).
     * Each entry has an alarm_type, e.g. 2 = motion, 6 = person, 17/18 = doorbell.
     * Cameras only keep this history when they record events to a microSD card.
     */
    getDetectionEvents(startTime: number, endTime: number): Promise<TAPODetectionEvent[]>;
}

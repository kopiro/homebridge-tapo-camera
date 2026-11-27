import { Logging } from "homebridge";
import { CameraConfig } from "./cameraAccessory";
import { DeviceInformation, NotificationMessage } from "./types/onvif";
import { EventEmitter } from "stream";
export declare class OnvifCamera {
    protected readonly log: Logging;
    protected readonly config: CameraConfig;
    private events;
    private device;
    private lastMotionValue;
    private lastPersonValue;
    private readonly kOnvifPort;
    constructor(log: Logging, config: CameraConfig);
    private getDevice;
    get onvifConnected(): boolean;
    getEventEmitter(): Promise<EventEmitter<any>>;
    restartOnvifConnection(): Promise<boolean>;
    private startOnvifListener;
    /**
     * Returns the value of a named ONVIF data item, or undefined if the event
     * doesn't have it. The onvif library gives a single object when there is one
     * item and an array when there are several.
     */
    static findDataItem(event: NotificationMessage | undefined, name: string): unknown;
    getDeviceInfo(): Promise<DeviceInformation>;
}

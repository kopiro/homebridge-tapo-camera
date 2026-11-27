import { API, IndependentPlatformPlugin, Logging, PlatformConfig } from "homebridge";
import { CameraConfig } from "./cameraAccessory";
export interface CameraPlatformConfig extends PlatformConfig {
    cameras?: CameraConfig[];
}
export declare class CameraPlatform implements IndependentPlatformPlugin {
    readonly log: Logging;
    readonly config: CameraPlatformConfig;
    readonly api: API;
    readonly kDefaultPullInterval = 60000;
    constructor(log: Logging, config: CameraPlatformConfig, api: API);
    private discoverDevices;
    private setupCamera;
}

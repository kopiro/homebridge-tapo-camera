import {
  API,
  IndependentPlatformPlugin,
  Logging,
  PlatformConfig,
} from "homebridge";
import { CameraAccessory, CameraConfig } from "./cameraAccessory";

export interface CameraPlatformConfig extends PlatformConfig {
  cameras?: CameraConfig[];
}

export class CameraPlatform implements IndependentPlatformPlugin {
  public readonly kDefaultPullInterval = 60000;

  constructor(
    public readonly log: Logging,
    public readonly config: CameraPlatformConfig,
    public readonly api: API
  ) {
    this.discoverDevices();
  }

  private discoverDevices() {
    this.config.cameras?.forEach(async (cameraConfig) => {
      try {
        const cameraAccessory = new CameraAccessory(this, cameraConfig);
        await cameraAccessory.setup();
      } catch (err) {
        this.log.error("Error during setup of camera", cameraConfig, err);
      }
    });
  }
}

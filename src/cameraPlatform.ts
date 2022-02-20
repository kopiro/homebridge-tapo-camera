import {
  API,
  IndependentPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge";
import { CameraAccessory, CameraConfig } from "./cameraAccessory";
import { PLUGIN_ID, PLATFORM_NAME } from "./pkg";

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
        const accessory = new CameraAccessory(this, cameraConfig);
        await accessory.setup();
      } catch (err) {
        this.log.error(
          `Error during setup of camera ${cameraConfig.name}`,
          (err as Error)?.message
        );
      }
    });
  }

  private removeAccessory(platformAccessory: PlatformAccessory) {
    this.api.unregisterPlatformAccessories(PLUGIN_ID, PLATFORM_NAME, [
      platformAccessory,
    ]);
  }
}

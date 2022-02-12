import {
  API,
  IndependentPlatformPlugin,
  Logging,
  PlatformAccessory,
} from "homebridge";
import { CameraAccessory, CameraConfig } from "./cameraAccessory";
import { pkg } from "./pkg";

type CameraPlatformConfig = {
  cameras: CameraConfig[];
};

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
    this.api.unregisterPlatformAccessories(pkg.pluginId, pkg.platformName, [
      platformAccessory,
    ]);
  }
}

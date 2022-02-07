import {
  API,
  APIEvent,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge";
import { CameraAccessory, CameraConfig } from "./cameraAccessory";
import { pkg } from "./pkg";

type CameraPlatformConfig = {
  cameras: CameraConfig[];
};

export class CameraPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly config: CameraPlatformConfig;
  private readonly api: API;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.config = config as unknown as CameraPlatformConfig;
    this.api = api;

    this.api.on(
      APIEvent.DID_FINISH_LAUNCHING,
      this.didFinishLaunching.bind(this)
    );
  }

  didFinishLaunching() {
    this.config.cameras?.forEach(async (cameraConfig) => {
      try {
        const accessory = new CameraAccessory(this.log, cameraConfig, this.api);
        await accessory.setup();
      } catch (err) {
        this.log.error(
          `Error during setup of camera ${cameraConfig.name}`,
          (err as Error)?.message
        );
      }
    });
  }

  /*
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log("Configuring accessory %s", accessory.displayName);
    // Won't be called for unbridged accessories
  }

  removeAccessory(platformAccessory: PlatformAccessory) {
    this.api.unregisterPlatformAccessories(pkg.pluginId, pkg.platformName, [
      platformAccessory,
    ]);
  }
}

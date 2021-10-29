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
  private readonly cameraConfigs: Map<string, CameraConfig> = new Map();

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
    this.config.cameras.forEach((cameraConfig) => {
      const camera = new CameraAccessory(this.log, cameraConfig, this.api);
      this.api.publishExternalAccessories(pkg.pluginName, [camera.accessory]);
      this.cameraConfigs.set(camera.uuid, cameraConfig);
    });
  }

  /*
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log("Configuring accessory %s", accessory.displayName);
    const cameraConfig = this.cameraConfigs.get(accessory.UUID);
    if (cameraConfig) {
      new CameraAccessory(this.log, cameraConfig, this.api, accessory);
    }
  }
}

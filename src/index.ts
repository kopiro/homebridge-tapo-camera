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

class CameraPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly config: CameraPlatformConfig;
  private readonly api: API;

  private cameras: CameraAccessory[];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.config = config as unknown as CameraPlatformConfig;
    this.api = api;
    this.cameras = [];

    this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      this.cameras = this.config.cameras.map(
        (c) => new CameraAccessory(this.log, c, this.api)
      );
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug("Should never reach this");
  }
}

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  api.registerPlatform(pkg.pluginName, pkg.name, CameraPlatform);
};

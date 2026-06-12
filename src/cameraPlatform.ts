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
    this.config.cameras?.forEach((cameraConfig) => {
      this.setupCamera(cameraConfig);
    });
  }

  private async setupCamera(cameraConfig: CameraConfig, retryAfterSuspension = false): Promise<void> {
    try {
      const cameraAccessory = new CameraAccessory(this, cameraConfig);
      await cameraAccessory.setup();
    } catch (err) {
      const suspensionMatch =
        err instanceof Error &&
        err.message.match(/Try again in (\d+) seconds/);

      if (suspensionMatch && !retryAfterSuspension) {
        const seconds = parseInt(suspensionMatch[1], 10);
        this.log.warn(
          `Camera "${cameraConfig.name}" is temporarily suspended. Retrying in ${seconds} seconds...`
        );
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return this.setupCamera(cameraConfig, true);
      }

      this.log.error(
        `Error during setup of camera "${cameraConfig.name}"`,
        err,
        err instanceof Error ? err.stack : []
      );
    }
  }
}

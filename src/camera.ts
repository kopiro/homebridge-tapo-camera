import { Logging } from "homebridge";
import { CameraConfig } from "./cameraAccessory";

export class Camera {
  protected readonly log: Logging;
  protected readonly config: CameraConfig;

  constructor(log: Logging, config: CameraConfig) {
    this.log = log;
    this.config = config;
  }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CameraPlatform = void 0;
const cameraAccessory_1 = require("./cameraAccessory");
class CameraPlatform {
    log;
    config;
    api;
    kDefaultPullInterval = 60000;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.discoverDevices();
    }
    discoverDevices() {
        this.config.cameras?.forEach((cameraConfig) => {
            this.setupCamera(cameraConfig);
        });
    }
    async setupCamera(cameraConfig, retryAfterSuspension = false) {
        try {
            const cameraAccessory = new cameraAccessory_1.CameraAccessory(this, cameraConfig);
            await cameraAccessory.setup();
        }
        catch (err) {
            const suspensionMatch = err instanceof Error &&
                err.message.match(/Try again in (\d+) seconds/);
            if (suspensionMatch && !retryAfterSuspension) {
                const seconds = parseInt(suspensionMatch[1], 10);
                this.log.warn(`Camera "${cameraConfig.name}" is temporarily suspended. Retrying in ${seconds} seconds...`);
                await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
                return this.setupCamera(cameraConfig, true);
            }
            this.log.error(`Error during setup of camera "${cameraConfig.name}"`, err, err instanceof Error ? err.stack : []);
        }
    }
}
exports.CameraPlatform = CameraPlatform;
//# sourceMappingURL=cameraPlatform.js.map
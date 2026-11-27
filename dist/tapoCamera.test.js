"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
require("dotenv/config");
const tapoCamera_1 = require("./tapoCamera");
async function main() {
    const tapoCamera = new tapoCamera_1.TAPOCamera({ ...console }, {
        name: "Test",
        ipAddress: process.env.CAMERA_IP,
        username: process.env.CAMERA_USERNAME,
        password: process.env.CAMERA_PASSWORD,
        streamUser: process.env.CAMERA_STREAM_USERNAME,
        streamPassword: process.env.CAMERA_STREAM_PASSWORD,
    });
    const basicInfo = await tapoCamera.getBasicInfo();
    console.log("basicInfo :>> ", basicInfo);
    const status = await tapoCamera.getStatus();
    console.log("status :>> ", status);
    const streamUrl = tapoCamera.getAuthenticatedStreamUrl();
    console.log("streamUrl :>> ", streamUrl);
    await tapoCamera.setStatus("eyes", false);
    setTimeout(async () => {
        const status = await tapoCamera.getStatus();
        console.log("status :>> ", status);
    }, 5000);
}
main();
//# sourceMappingURL=tapoCamera.test.js.map
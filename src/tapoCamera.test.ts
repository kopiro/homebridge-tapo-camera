/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import "dotenv/config";

import { TAPOCamera } from "./tapoCamera";

async function main() {
  const tapoCamera = new TAPOCamera({ ...console } as any, {
    name: "Test",
    ipAddress: process.env.CAMERA_IP!,
    username: process.env.CAMERA_USERNAME!,
    password: process.env.CAMERA_PASSWORD!,
    streamUser: process.env.CAMERA_STREAM_USERNAME!,
    streamPassword: process.env.CAMERA_STREAM_PASSWORD!,
  });

  const basicInfo = await tapoCamera.getBasicInfo();
  console.log("basicInfo :>> ", basicInfo);

  const status = await tapoCamera.getStatus();
  console.log("status :>> ", status);

  const streamUrl = await tapoCamera.getAuthenticatedStreamUrl();
  console.log("streamUrl :>> ", streamUrl);

  await tapoCamera.moveMotorStep(359);

  await tapoCamera.setLensMaskConfig(false);
  setTimeout(async () => {
    const status = await tapoCamera.getStatus();
    console.log("status :>> ", status);
  }, 5000);
}

main();

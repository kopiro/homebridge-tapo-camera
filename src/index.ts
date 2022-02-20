import { API } from "homebridge";
import { CameraPlatform } from "./cameraPlatform";
import { PLATFORM_NAME } from "./pkg";

export = (api: API) => {
  api.registerPlatform(PLATFORM_NAME, CameraPlatform);
};

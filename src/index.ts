import { API } from "homebridge";
import { CameraPlatform } from "./cameraPlatform";
import { pkg } from "./pkg";

export = (api: API) => {
  api.registerPlatform(pkg.pluginId, pkg.platformName, CameraPlatform);
};

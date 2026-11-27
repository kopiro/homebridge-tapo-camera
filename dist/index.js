"use strict";
const cameraPlatform_1 = require("./cameraPlatform");
const pkg_1 = require("./pkg");
module.exports = (api) => {
    api.registerPlatform(pkg_1.PLATFORM_NAME, cameraPlatform_1.CameraPlatform);
};
//# sourceMappingURL=index.js.map
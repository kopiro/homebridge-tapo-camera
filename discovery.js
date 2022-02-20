const { promisify } = require("util");
const Cam = require("onvif").Cam;

// try each IP address and each Port
new Cam(
  {
    hostname: process.env.IP_ADDRESS,
    username: process.env.USER,
    password: process.env.PASS,
    port: 2020,
  },
  async function CamFunc(err) {
    if (err) {
      if (err.message) {
        console.log(err.message);
      } else {
        console.log(err);
      }
      return;
    }

    var camObj = this;

    // Use Promisify that was added to Nodev8

    const promiseGetSystemDateAndTime = promisify(
      camObj.getSystemDateAndTime
    ).bind(camObj);
    const promiseGetDeviceInformation = promisify(
      camObj.getDeviceInformation
    ).bind(camObj);
    const promiseGetProfiles = promisify(camObj.getProfiles).bind(camObj);
    const promiseGetSnapshotUri = promisify(camObj.getSnapshotUri).bind(camObj);
    const promiseGetStreamUri = promisify(camObj.getStreamUri).bind(camObj);

    // Use Promisify to convert ONVIF Library calls into Promises.
    let gotDate = await promiseGetSystemDateAndTime();
    let gotInfo = await promiseGetDeviceInformation();

    let videoResults = "";
    let profiles = await promiseGetProfiles();
    for (const profile of profiles) {
      // wrap each URI Stream request in a Try/Catch as some requests (eg for multicast) may return an error
      // the alternative would be a Promise.Then.Catch and wait for each Promise to complete(resolve)
      videoResults +=
        "Profile: Name=" +
        profile.name +
        " Token=" +
        profile.$.token +
        " VideoSource=" +
        profile.videoSourceConfiguration.name +
        "\r\n";

      try {
        videoResults += "SNAPSHOT URL   ";
        let snapshotUri = await promiseGetSnapshotUri({
          profileToken: profile.$.token,
        });
        videoResults +=
          profile.name +
          " " +
          "JPEG" +
          " " +
          profile.videoEncoderConfiguration.resolution.width +
          "x" +
          profile.videoEncoderConfiguration.resolution.height +
          " " +
          snapshotUri.uri +
          "\r\n";
      } catch (err) {
        videoResults += profile.name + " not supported\r\n";
      }

      let stream;
      try {
        videoResults += "RTSP TCP       ";
        stream = await promiseGetStreamUri({
          profileToken: profile.$.token,
          protocol: "RTSP",
          stream: "RTP-Unicast",
        });
        videoResults +=
          profile.name +
          " " +
          profile.videoEncoderConfiguration.encoding +
          " " +
          profile.videoEncoderConfiguration.resolution.width +
          "x" +
          profile.videoEncoderConfiguration.resolution.height +
          " " +
          stream.uri +
          "\r\n";
      } catch (err) {
        videoResults += profile.name + " not supported\r\n";
      }

      try {
        videoResults += "RTSP UDP       ";
        stream = await promiseGetStreamUri({
          profileToken: profile.$.token,
          protocol: "UDP",
          stream: "RTP-Unicast",
        });
        videoResults +=
          profile.name +
          " " +
          profile.videoEncoderConfiguration.encoding +
          " " +
          profile.videoEncoderConfiguration.resolution.width +
          "x" +
          profile.videoEncoderConfiguration.resolution.height +
          " " +
          stream.uri +
          "\r\n";
      } catch (err) {
        videoResults += profile.name + " not supported\r\n";
      }

      try {
        videoResults += "RTSP Multicast ";
        stream = await promiseGetStreamUri({
          profileToken: profile.$.token,
          protocol: "UDP",
          stream: "RTP-Multicast",
        });
        videoResults +=
          profile.name +
          " " +
          profile.videoEncoderConfiguration.encoding +
          " " +
          profile.videoEncoderConfiguration.resolution.width +
          "x" +
          profile.videoEncoderConfiguration.resolution.height +
          " " +
          stream.uri +
          "\r\n";
      } catch (err) {
        videoResults += profile.name + " not supported\r\n";
      }

      try {
        videoResults += "RTSP HTTP      ";
        stream = await promiseGetStreamUri({
          profileToken: profile.$.token,
          protocol: "HTTP",
          stream: "RTP-Unicast",
        });
        videoResults +=
          profile.name +
          " " +
          profile.videoEncoderConfiguration.encoding +
          " " +
          profile.videoEncoderConfiguration.resolution.width +
          "x" +
          profile.videoEncoderConfiguration.resolution.height +
          " " +
          stream.uri +
          "\r\n";
      } catch (err) {
        videoResults += profile.name + " not supported\r\n";
      }
    }

    console.log(JSON.stringify(profiles, null, 2));

    console.log("------------------------------");
    console.log("Date: = " + gotDate);
    console.log("Info: = " + JSON.stringify(gotInfo));
    console.log(videoResults);
    console.log("------------------------------");
  }
);

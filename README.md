# homebridge-tapo-camera

Make your TP-Link TAPO security camera compatible with Homekit through Homebridge.

The plugin exposes the camera RSTP video feed and 2 accessories to control "Privacy Mode" and "Alarm".

#### Video Feed

<img width="200px" src="https://user-images.githubusercontent.com/839700/138455588-a0754e1c-2d85-4f3f-a5cf-8e2468236c1f.PNG" />

#### Accessories

<img width="200px" src="https://user-images.githubusercontent.com/839700/138455583-8a5f74e7-057d-457d-8efd-789d9976ddd7.PNG" />

The accessory called "Eyes" controls the privacy mode; when it's on it means that the camera is able to see.
This is to make sure we support "Hey Siri, turn on Camera" (this will disable privacy mode and enable alarm).

The accessory called "Alarm" switch on/off the sound alarm, but not notifications.

#### Motion Detection

The motion detection is built on top of the ONVIF protocol and it is enabled by default; therefore you can setup
automations and Homekit can send you notification when a motion is detected.

## Installation

You can install it via Homebridge UI or manually using:

```sh
npm -g install homebridge-tapo-camera
```

### Configuration

Add this configuration in the `platforms` key in your Homebridge configuration.

- `__IP_ADDRESS__` is the IP address of the camera in your local network; as long you have a bridge setup, you can also fully control the camera outisde your Home.
- `__PASSWORD__` is the password of your TAPO Cloud account, the username/email is not needed.
- `__STREAM_USER__` and `__STREAM_PASSWORD__` are the credentials you set in Settings > Advanced Settings > Camera Account.

```json5
{
  // bridge and accessories config
  "platforms": [
    platform: "TAPO-CAMERA",
    cameras: [
      {
        name: "Adamo",

        ipAddress: "__IP_ADDRESS__",
        password: "__PASSWORD__",
        streamPassword: "__STREAM_PASSWORD__",
        streamUser: "__STREAM_USER__",

        // Optionals
        pullInterval: 60000, // Numbers of milleseconds after we update accessories by polling
        debug: false, // Enables verbose logs
        disableStreaming: false, // Disable the video feed
        disablePrivacyAccessory: false, // Disable the privacy accessory
        disableAlarmAccessory: false, // Disable the alarm accessory
        disableMotionAccessory: false, // Disable the motion detection sensor
        lowQuality: false, // Video stream will be requested in low-quality (640x480) instead of HQ (1920x1080)
      },

      // Second camera (if any)
      {},
    ],
  ]
}
```

### Adding the unbridged accessory to Home

This plugin configures the cameras as unbridged accessories, therefore you need to manually add them in your Home app;
use the code that HomeBridge give you.

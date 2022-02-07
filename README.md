# homebridge-tapo-camera

Make your TP-Link TAPO security camera compatible with Homekit through Homebridge / HOOBS.

![photo_2021-11-23 11 57 48](https://user-images.githubusercontent.com/839700/143013358-9f6eed44-3aad-40b0-b1e5-ddc2c5bb24e4.png)

The plugin exposes the camera RSTP video feed, 2 accessories to control "Privacy Mode" and "Alarm" and a motion detection accessory.

The accessory called _"Eyes"_ controls the privacy mode; when it's on it means that the camera is able to see
(this is to make sure we support the command "Hey Siri, turn _on_ Camera", as this will _disable_ privacy mode and enable alarm).

The accessory called _"Alarm"_ switches on/off the alarm sound, but keep in mind that notifications will still be sent to the phone.

The motion detection is built on top of the ONVIF protocol and it is enabled by default; therefore you can setup
automations and Homekit can send you notification when motion is detected.

## Installation

You can install it via Homebridge UI or manually using:

```sh
npm -g install homebridge-tapo-camera
```

### Configuration

It is highly recommended that you use either Homebridge Config UI X or the HOOBS UI to install and configure this plugin.

### Adding the unbridged accessory to Home

Once done you will have unbridged accessories, therefore you need to manually add them in your Home app.

### Manual configuration

If you want to have manual control over the configuration, add the following configuration in the `platforms` key:

```json5
{
  // ...
  platforms: [
    // Other platforms
    {
      // Note, if you've upgraded the plugin and you have no more camera in the Home app, you need to change this to "tapo-camera" lowercase (before v1.6.2 it was "TAPO-CAMERA")
      platform: "tapo-camera",
      cameras: [
        {
          name: "Adamo",

          ipAddress: "__IP_ADDRESS__",
          password: "__PASSWORD__",
          streamPassword: "__STREAM_PASSWORD__",
          streamUser: "__STREAM_USER__",

          // Optionals, don't put them in the config if you need the default values
          pullInterval: 60000, // Numbers of milleseconds after we update accessories by polling
          debug: false, // Enables verbose logs in the video-ffmpeg plugin
          disableStreaming: false, // Disables the video feed
          disablePrivacyAccessory: false, // Disables the privacy accessory
          disableAlarmAccessory: false, // Disables the alarm accessory
          disableMotionAccessory: false, // Disables the motion detection sensor
          lowQuality: false, // Video stream will be requested in low-quality (640x480) instead of HQ (1920x1080)
        },
      ],
    },
  ],
}
```

- `__IP_ADDRESS__` is the IP address of the camera in your local network; as long you have a bridge setup, you can also fully control the camera outisde your Home.
- `__PASSWORD__` is the password of your TAPO Cloud account, the username/email is not needed.
- `__STREAM_USER__` and `__STREAM_PASSWORD__` are the credentials you set in Settings > Advanced Settings > Camera Account.

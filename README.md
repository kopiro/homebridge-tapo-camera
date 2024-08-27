# homebridge-tapo-camera

Make your TP-Link TAPO security camera compatible with Homekit through Homebridge / HOOBS.

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

![photo_2021-11-23 11 57 48](https://user-images.githubusercontent.com/839700/143013358-9f6eed44-3aad-40b0-b1e5-ddc2c5bb24e4.png)

The plugin exposes the camera RTSP video feed, and toggle accessories to configure your automations.

### Toggle accessories

- _"Eyes"_ controls the privacy mode; when it's on it means that the camera is able to see
(this is to make sure we support the command "Hey Siri, turn _on_ Camera", as this will _disable_ privacy mode).

- _"Alarm"_ switches on/off the alarm sound.

- _"Notifications"_ switches on/off the notifications sent to your TAPO app.

- _"Motion Detection"_ switches on/off the motion detection system.

- _"LED"_ switches on/off the LED.

An example Home automation could be:

- When leaving home, enable *Eyes, Alarm, Notifications, Motion Detection, LED*
- When arriving home:
	- If you care about your privacy, disable *Eyes* to switch on privacy mode
	- If you want the camera always on, but no notifications, just disable *Alarm* and *Notifications*

### Motion sensor

The motion detection sensor is built on top of the ONVIF protocol and it is enabled by default.

Therefore you can set up automations and Homekit can send you notification in the Home app when motion is detected.

Make sure you activate "Activity Notifications" in the "Status and Notifications" tab in the accessory.

> [!NOTE]  
> Some people may have issues resulting the plugin crashing at startup when this option is enabled. If you see an error like `Error: read ECONNRESET at TCP.onStreamRead` try to disable the motion sensor by setting `disableMotionSensorAccessory` to `true`

## Installation

You can install it via Homebridge UI or manually using:

```sh
npm -g install homebridge-tapo-camera
```

### Configuration

It is highly recommended that you use either Homebridge Config UI X or the HOOBS UI to install and configure this plugin.

### FFmpeg installation

The plugin should take care of installing the `ffmpeg` automatically.

> [!IMPORTANT]  
> If you're getting errors like `FFmpeg exited with code: 1 and signal: null (Error)`, please follow the instructions here on how to install [ffmpeg-for-homebridge](https://github.com/homebridge/ffmpeg-for-homebridge) binaries manually.

### Adding the unbridged accessory to Home

Once done you will have unbridged accessories, therefore you need to manually add them in your Home app.

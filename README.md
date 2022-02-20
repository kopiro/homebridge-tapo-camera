# homebridge-tapo-camera

Make your TP-Link TAPO security camera compatible with Homekit through Homebridge / HOOBS.

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

![photo_2021-11-23 11 57 48](https://user-images.githubusercontent.com/839700/143013358-9f6eed44-3aad-40b0-b1e5-ddc2c5bb24e4.png)

The plugin exposes the camera RTSP video feed, 2 accessories to control "Privacy Mode" and "Alarm" and a motion detection accessory.

The accessory called _"Eyes"_ controls the privacy mode; when it's on it means that the camera is able to see
(this is to make sure we support the command "Hey Siri, turn _on_ Camera", as this will _disable_ privacy mode and enable alarm).

The accessory called _"Alarm"_ switches on/off the alarm sound, but keep in mind that notifications will still be sent to the phone.

The motion detection is built on top of the ONVIF protocol and it is enabled by default; therefore you can set up
automations and Homekit can send you notification when motion is detected.

## Installation

You can install it via Homebridge UI or manually using:

```sh
npm -g install homebridge-tapo-camera
```

### Configuration

It is highly recommended that you use either Homebridge Config UI X or the HOOBS UI to install and configure this plugin.

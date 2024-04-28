## Ruuvi Gateway Xiomi BLE sensor MQTT discovery for Home Assistant

Ruuvi Gateway supports other BLE sensors other than Ruuvitags and publishes their data in MQTT. This app provides support for some Xiomi BLE sensors and parses their data and publishes MQTT discovery for Home Assistant

## Building and testing locally

Create haconfig directory for homeassistant config directory

Build and run:

```bash
docker-compose up -d --build
```

## Running with Home Assistant

Simples way is to run it using docker-compose.yml. The latest versio is available direct from Docker Hub so no need to even build it locally.

```yml
version: "3.4"
services:
  mqtt:
    image: eclipse-mosquitto
    volumes:
      - ./mosquitto.conf:/mosquitto/config/mosquitto.conf
  ruuvibridge-ha-mqtt:
    image: mikakoivisto/ruuvigw-xiomi-ha-mqtt:latest
    links:
      - mqtt
    env_file: 
      - docker.env
```

## Configuration

Add following to docker.env file

```
MQTTHOST=mqtt
MQTTPORT=
MQTTUSER=
MQTTPASS=
RUUVITOPIC=ruuvi
XIOMITOPIC=xiomi
HASSTOPIC=homeassistant/status
DEBUG=app:info,*:error
```

You can also limit which attributes are exposed to Home Assistant with RUUVIATTRIBUTES environment variable. Example:
```
ATTRIBUTES=temperature,humidity,dewPoint,battery,voltage
```

Limitations: Currently only ATC firmware format for temperature and humidity sensor is supported. Others will be added when I have devices to test them with.
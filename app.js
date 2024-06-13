const mqttApi = require('mqtt');
const logDebug = require('debug')('app:debug');
const logError = require('debug')('app:error');
const logInfo = require('debug')('app:info');

logInfo.log = console.log.bind(console);

const config = {
  mqttHost: process.env.MQTTHOST || '192.168.1.209',
  mqttPort: process.env.MQTTPORT || '1883',
  mqttUser: process.env.MQTTUSER,
  mqttPass: process.env.MQTTPASS,
  xiomiTopic: process.env.XIOMITOPIC || "xiomi",
  ruuvitagTopic: process.env.RUUVITOPIC || "ruuvi",
  homeassistantTopicPrefix: process.env.HASSTOPICPREFIX || 'homeassistant',
  hassTopic: process.env.HASSTOPIC ||  'homeassistant/status',
  objectIdPrefix: process.env.OBJECTIDPREFIX || '',
  attributes: process.env.ATTRIBUTES || '',
}

logDebug(JSON.stringify(config));

class App {
  mqtt;
  discoveredTags = {};
  config;
  includeAttributes = [];
  constructor(config) {

    this.config = config;
    if (config.attributes !== '') {
      this.includeAttributes = config.attributes.split(',');
    }
    this.mqtt = mqttApi.connect({
      host: config.mqttHost,
      port: config.mqttPort,
      username: config.mqttUser,
      password: config.mqttPass
    }).on('connect', () => {
      this.registerEventListeners();
      this.mqttConnected();
    });
  }

  mqttConnected() {
    logInfo('MQTT connection established');
    this.mqtt.subscribe(config.homeassistantTopicPrefix + "/status");
    this.mqtt.subscribe(config.ruuvitagTopic + "/#");
  }

  registerEventListeners() { 
    let self = this;   

    self.mqtt.on('reconnect', () => { 
      logInfo('Attempting to reconnect to MQTT broker');
    });

    self.mqtt.on('error', (error) => {
      logError('Unable to connect to MQTT broker.', error.message);
    });

    self.mqtt.on('message', (topic, message) => {
      logDebug('Message received on ' + topic);
      self.handleMessage(topic, message.toString());
    });
  }

  handleMessage(topic, payload) {
    let self = this;
    if (topic === self.config.hassTopic) {
      logInfo("HA reloaded");
      self.discoveredTags = {};
      return;
    }
   
    let measurement = JSON.parse(payload);
    logDebug(topic + ": " + payload);
    if (measurement.data === undefined)
      return;
    measurement.mac = /[^/]*$/.exec(topic)[0];
    
    if (measurement.data.indexOf("10161A18A4C") !== -1) {
      // flashed ATC
      let data = hexToBytes(measurement.data)
      let temp = parseInt(intToHex(data[10]) + intToHex(data[11]), 16) / 10.0;
      let humidity = parseInt(intToHex(data[12]), 16);
      let equilibriumVaporPressure = 611.2 * Math.exp(17.67 * (temp) / (243.5 + temp));
      let v = Math.log((humidity / 100) * (equilibriumVaporPressure) / 611.2);
      let dewPoint = -243.5 * v / (v - 17.67);
      let absoluteHumidity = equilibriumVaporPressure * humidity * 0.021674 / (273.15 + temp);
      let out = {
        temperature: temp,
        humidity: humidity,
        battery: parseInt(intToHex(data[13]), 16),
        voltage: parseInt(intToHex(data[14]) + intToHex(data[15]), 16) / 1000.0,
        equilibriumVaporPressure: +equilibriumVaporPressure.toFixed(3),
        dewPoint: +dewPoint.toFixed(3),
        absoluteHumidity: +absoluteHumidity.toFixed(3),
        mac: measurement.mac,
        rssi: measurement.rssi,
        type: "ACT_MI_TEMP",
        updated: measurement.ts,
        rawData: measurement.data
      };
      let mac = measurement.mac.replaceAll(':','').toLowerCase();

      //console.log(JSON.stringify(out));

      logDebug(`Publishing to ${config.xiomiTopic}/${mac} data: ${JSON.stringify(out)}`);
      if (!self.discoveredTags[mac]) {
        self.discoveredTags[mac] = true;
        this.publishDiscovery(out);
      }
      self.mqtt.publish(config.xiomiTopic + "/" + mac, JSON.stringify(out), { retain: true});
    } else if (measurement.data.indexOf("02010603029") !== -1) {
      // mi flora
      let data = hexToBytes(measurement.data)
      var dataType = data[23];
      var out = {
        mac: measurement.mac,
        type: "Mi Flora",
        updated: measurement.ts,
        rssi: measurement.rssi,
        rawData: measurement.data
      };
      var type;
      switch (dataType) {
            case 7: // LIGHT
              type = "illuminance";
              out.light = parseInt(intToHex(data[data.length - 1]) + intToHex(data[data.length - 2]) + intToHex(data[data.length - 3]), 16);
              break;
            case 9: // CONDUCTIVITY 
              type = "conductivity";
              out.conductivity = parseInt(intToHex(data[data.length - 1]) + intToHex(data[data.length - 2]), 16);
              break;
            case 8: // MOISTURE
              type = "moisture";
              out.moisture = (data[data.length - 1]);
              break;
            case 4: // TEMPERATURE
              type = "temperature";
              out.temperature = parseInt(intToHex(data[data.length - 1]) + intToHex(data[data.length - 2]), 16) / 10.0;
              break;
            case 5: // BATTERY
              type = "battery";
              out.battery = data[data.length - 1];
              break;
            default:
              console.log("FlowerCare unknown dataType", dataType, measurement.data);
              return;
      }
      let mac = measurement.mac.replaceAll(':','').toLowerCase();

      console.log(JSON.stringify(out));
      logDebug(`Publishing to ${config.xiomiTopic}/${mac}/${type} data: ${JSON.stringify(out)}`);
      if (!self.discoveredTags[mac]) {
        self.discoveredTags[mac] = true;
        this.publishDiscovery(out);
      }
      self.mqtt.publish(config.xiomiTopic + "/" + mac + "/" + type, JSON.stringify(out), { retain: true});
    } else if (measurement.data.indexOf("0201060302") !== -1)  {
      console.log("Potential flower care data ", measurement.data);
    }
  }

  publishDiscovery(measurement) {
    let self = this;
    switch (measurement.type) {
      case "ACT_MI_TEMP": 
        this.publishSensorDiscovery(measurement, {
          deviceClass: "temperature",
          namePostfix: "temperature",
          jsonAttribute: "temperature",
          jsonAttributeMutator: "",
          unitOfMeasurement: "°C",
          precision: 1,
          battery: true,
        });
        this.publishSensorDiscovery(measurement, {
          deviceClass: "humidity",
          namePostfix: "humidity",
          jsonAttribute: "humidity",
          jsonAttributeMutator: "",
          unitOfMeasurement: "%",
          precision: 1,
          battery: true,
        });
        this.publishSensorDiscovery(measurement, {
          deviceClass: "voltage",
          namePostfix: "battery voltage",
          jsonAttribute: "voltage",
          jsonAttributeMutator: "",
          unitOfMeasurement: "V",
          precision: 3,
          battery: true,
        });
        this.publishSensorDiscovery(measurement, {
          deviceClass: "battery",
          namePostfix: "battery",
          jsonAttribute: "battery",
          jsonAttributeMutator: "",
          unitOfMeasurement: "%",
          precision: 0,
          battery: true,
        });
        this.publishSensorDiscovery(measurement, {
          namePostfix: "absolute humidity",
          jsonAttribute: "absoluteHumidity",
          jsonAttributeMutator: "",
          unitOfMeasurement: "g/m³",
          precision: 2,
          icon: "mdi:water",
          battery: true,
        });
        this.publishSensorDiscovery(measurement, {
          deviceClass: "temperature",
          namePostfix: "dew point",
          jsonAttribute: "dewPoint",
          jsonAttributeMutator: "",
          unitOfMeasurement: "°C",
          precision: 1,
          icon: "mdi:water",
          battery: true,
        });
        this.publishSensorDiscovery(measurement, {
          deviceClass: "pressure",
          namePostfix: "equilibrium vapor pressure",
          jsonAttribute: "equilibriumVaporPressure",
          jsonAttributeMutator: "",
          unitOfMeasurement: "Pa",
          precision: 1,
          battery: true,
        });
        break;
      case "Mi Flora":
        this.publishSensorDiscovery(measurement, {
          deviceClass: "temperature",
          namePostfix: "temperature",
          jsonAttribute: "temperature",
          jsonAttributeMutator: "",
          unitOfMeasurement: "°C",
          precision: 1,
          stateTopicPostfix: "temperature",
          battery: false,
          skipAttributeCheck: true,
        });
        this.publishSensorDiscovery(measurement, {
          deviceClass: "moisture",
          namePostfix: "moisture",
          jsonAttribute: "moisture",
          jsonAttributeMutator: "",
          unitOfMeasurement: "%",
          precision: 0,
          icon: "mdi:water-percent",
          stateTopicPostfix: "moisture",
          battery: false,
          skipAttributeCheck: true,
        });
        this.publishSensorDiscovery(measurement, {
          deviceClass: "illuminance",
          namePostfix: "illuminance",
          jsonAttribute: "light",
          jsonAttributeMutator: "",
          unitOfMeasurement: "lx",
          precision: 0,
          stateTopicPostfix: "illuminance",
          battery: false,
          skipAttributeCheck: true,
        });
        this.publishSensorDiscovery(measurement, {
          namePostfix: "conductivity",
          jsonAttribute: "conductivity",
          jsonAttributeMutator: "",
          unitOfMeasurement: "µS/cm",
          icon: "mdi:flash-circle",
          precision: 0,
          stateTopicPostfix: "conductivity",
          battery: false,
          skipAttributeCheck: true,
        });
        this.publishSensorDiscovery(measurement, {
          deviceClass: "battery",
          namePostfix: "battery",
          jsonAttribute: "battery",
          jsonAttributeMutator: "",
          unitOfMeasurement: "%",
          precision: 0,
          battery: false,
          skipAttributeCheck: true,
        });
        break;
    }
  }

  publishSensorDiscovery(measurement, disco) {
    let self = this;
    if (!measurement[disco.jsonAttribute] && !disco.skipAttributeCheck) {
      logDebug(`${disco.jsonAttribute} not present in measurement for tag ${measurement.mac}, skipping discovery`);
      return;
    }
    if (self.includeAttributes.length > 0 && !self.includeAttributes.includes(disco.jsonAttribute)) {
      logDebug(self.includeAttributes + " length: " + self.includeAttributes.length);
      logDebug(`${disco.jsonAttribute} not in included attributes, skipping discovery`);
      return;
    }
    let objectIdPrefix = (config.objectIdPrefix !== '') ? config.objectIdPrefix + '_' : '';
    let mac = measurement.mac.replaceAll(':','').toLowerCase();
    let id = `xiomi_${mac}_${disco.jsonAttribute}`;
    let objectId = `${objectIdPrefix}${mac}_${disco.jsonAttribute}`;
    let confTopic = `${config.homeassistantTopicPrefix}/sensor/${objectId}/config`;
    let stateTopic = (disco.stateTopicPostfix && disco.stateTopicPostfix !== '') ? `${config.xiomiTopic}/${mac}/${disco.stateTopicPostfix}` : `${config.xiomiTopic}/${mac}`;
    let deviceName = (measurement.name && measurement.name !== '') ? `${measurement.name}` : `Xiomi sensor ${mac.slice(-6)}`;
    let name = (measurement.name && measurement.name !== '') ? `${measurement.name} ${disco.namePostfix}` : `${disco.namePostfix}`;
    let valueTemplate = `{{ value_json.${disco.jsonAttribute}${disco.jsonAttributeMutator} | float | round(${disco.precision}) }}`;
    let attributesTemplate = disco.battery ? `{
      "mac": "{{value_json.mac}}",
      "updated": "{{value_json.updated}}",
      "rssi": "{{value_json.rssi}}",
      "battery": "{{value_json.battery}}",
      "voltage": "{{value_json.voltage}}",
      "rawData": "{{value_json.rawData}}"
    }` : `{
      "mac": "{{value_json.mac}}",
      "updated": "{{value_json.updated}}",
      "rssi": "{{value_json.rssi}}",
      "rawData": "{{value_json.rawData}}",
      "type": "{{value_json.type}}"
    }`;

    let discoveryConfig = {
      unique_id: id,
      object_id: objectId,
      name: name,
      device_class: disco.deviceClass,
      state_class: "measurement",
      state_topic: stateTopic,
      json_attributes_topic: stateTopic,
      value_template: valueTemplate,
      json_attributes_template: attributesTemplate,
      icon: disco.icon,
      unit_of_measurement: disco.unitOfMeasurement,
      device: {
        manufacturer: "Xiomi",
        model: measurement.type,
        identifiers: [ mac ],
        name: deviceName
      }
    };

    logInfo(`Publishing to ${confTopic} discovery: ${JSON.stringify(discoveryConfig)}`);
    self.mqtt.publish(confTopic, JSON.stringify(discoveryConfig), { retain: true});
  }
}
function hexToBytes(hex) {
  for (var bytes = [], c = 0; c < hex.length; c += 2)
  bytes.push(parseInt(hex.substr(c, 2), 16));
  return bytes;
}
function intToHex(val) {
  return ("00" + val.toString(16)).slice(-2);
}
const app = new App(config);
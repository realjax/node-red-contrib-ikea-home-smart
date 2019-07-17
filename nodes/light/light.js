const serialise = require('../../common/serialise');
const _ = require('lodash');

module.exports = function (RED) {
  'use strict';

  function IkeaLightNode(config) {
    RED.nodes.createNode(this, config);
    let node = this;
    node.server = RED.nodes.getNode(config.gateway);
    node.connection = false;
    node.lightReachable = true; //is the light reachable by the gateway ? ( for instance when power switched off by wall switch)
    node.gatewayReachable = true; // is the gateway reachable? ( for instance when coap client can't (temporarily) talk to gateway )
    node.interval = null;
    node.lastMessageReceived = {};
    node.direction = 1;
    node.retMsg = null;
    node.light = null;

    // set initial state of this node
    node.status({fill: 'grey', shape: 'ring', text: 'not connected'});

    node.debuglog = function(message, level = "debug"){
      eval('RED.log.'+level+'(this.constructor.name + " \'" + node.name +"\'" +" : "+message)');
    };

    node.server.getConnection.then(
      _ => node.onConnected(),
      _ => node.status({fill: 'red', shape: 'ring', text: 'could not connect'})
    ).catch((err) => console.log("light error: ",err));

    node.onConnected = function(){
      node.gatewayReachable = node.server.gatewayReachable;
      node.status({fill: 'green', shape: 'ring', text: 'Connected to gateway'});
      node.server.registerListener(node.server.types.ACCESSORY,config.deviceId,node.id, node.registeredCallback);

      if (config.detectAlive) {
        node.aliveCheckLoop();
      }
      node.on("input", (msg) => {
        if (!msg.hasOwnProperty("payload") ) { return; } // do nothing unless we have a payload and the everything is up and running.
        node.retMsg = null;
        node.light = node.server.getAccessory(config.deviceId).lightList[0];
        let cmd = msg.payload.toUpperCase();

        if (node.lightReachable && node.gatewayReachable) {
          node.doAction(cmd);
        }else if (cmd === "STATUS"){
          node.doAction(cmd);
        }

        if (node.retMsg !== null) node.send([node.retMsg]);
      });

      node.on("close", function(removed, done) {
        clearInterval(node.aliveCheckinterval);
        node.server.unregisterListener(node.server.types.ACCESSORY,config.deviceId,node.id);
        done();
      });
    };

    node.doAction = function(action){
      node.retMsg = null;
      let runAction = {
        "STATUS" : _ => node.retMsg = {"payload": {"status": serialise.lightFromAccessory(node.server.getAccessory(config.deviceId))}} ,
        "TOGGLE" : _ => node.light.toggle().catch((err) => console.log("error toggling ", err)),
        "ON" : _ => node.light.turnOn().then(_ => console.log("was turned on")).catch((err) => console.log("err ", err)),
        "OFF" : _ => node.light.turnOff().then(_ => console.log("was turned off")).catch((err) => console.log("err ", err)),
        "SETCOLORTEMPERATURE": _ => node.light.setColorTemperature(60).then(_ => console.log("colortemp set to 60")).catch((err) => console.log("err ", err)),
        "default": _ => {/* do nothing */}
      };
      return (runAction[action] || runAction['default'])();
    };

    node.aliveCheckLoop = function(){
      let secondsInterval = 20000 + ((Math.floor(Math.random() * 20) + 1 ) * 1000); // random between 20 and 40 seconds.
      node.aliveCheckinterval = setInterval(() => {
        let light = node.server.getAccessory(config.deviceId).lightList[0];
        if (node.lightReachable) {
          node.debuglog("in the aliveCheckLoop every "+ secondsInterval/1000 + " seconds");
          // increase and decrease colortemp continuously to detect an alive = false situation.
          light.setColorTemperature(light.colorTemperature + node.direction).then(_=>{}).catch((err)=>console.log("caught checkloop error ",err));
          node.direction *= -1;
        }
      },secondsInterval
      );
    };

    node.registeredCallback = function(message) {
      let actions = {
        "status": function(message) {
          let lightObject = serialise.lightFromAccessory(message.content);
          if (!_.isEqualWith(node.lastMessageReceived, lightObject, serialise.lightColorTempComparator)) {
            let stateColor = !message.content.alive ? "red" : message.content.lightList[0].onOff ? "green" : "grey";
            node.status({
              fill: stateColor,
              shape: 'ring',
              text: 'Light is ' + (stateColor === "red" ? "not powered" : stateColor === "green" ? "on" : "off")
            });
            node.send([{"payload": lightObject}]);
          }
          node.lightReachable = message.content.alive;
          node.lastMessageReceived = lightObject;
        },
        "connectivity": function(message){
          if (config.detectAlive) {
             if (!message.content.gatewayReachable) {
               clearInterval(node.aliveCheckinterval)
             }else {
               node.lastMessageReceived = {};
               node.lightReachable = true;
               node.aliveCheckLoop();
             }
          }
          let statusObject = message.content.gatewayReachable?{text: "Connected to gateway",fill: "green", shape: "ring"}:{text: "Disconnected from gateway",fill: "red", shape: "ring" };
          node.status(statusObject);
        }
      };
      actions[message.type](message);

    };

  }
  RED.nodes.registerType('ikea-light', IkeaLightNode);
};

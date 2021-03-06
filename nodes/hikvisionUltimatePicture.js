
module.exports = function (RED) {

	const jimp = require("jimp"); // Resize


	function hikvisionUltimatePicture(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.server = RED.nodes.getNode(config.server)
		node.picture; // Stores the cam image
		node.pictureLarghezza = 0;
		node.pictureAltezza = 0;

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// 15/12/2020 apply the manipulation to the node's variable
		node.variabilizeManipulation = (_config) => {
			node.channelID = (_config.channelID === null || _config.channelID === undefined) ? "1" : _config.channelID;
			node.qualityimage = (_config.qualityimage === null || _config.qualityimage === undefined || _config.qualityimage.trim() === "") ? "80" : _config.qualityimage;
			node.rotateimage = (_config.rotateimage === null || _config.rotateimage === undefined) ? "0" : _config.rotateimage;
			node.widthimage = (_config.widthimage === null || _config.widthimage === undefined || _config.widthimage.trim() === "") ? "0" : _config.widthimage;
			node.heightimage = (_config.heightimage === null || _config.heightimage === undefined || _config.heightimage.trim() === "") ? "0" : _config.heightimage;
			node.cropimage = (_config.cropimage === null || _config.cropimage === undefined || _config.cropimage.trim() === "") ? "" : _config.cropimage;
			if (node.cropimage !== "" && node.cropimage.split(",").length === 4) {
				node.cropimage = {
					x: Number(node.cropimage.split(",")[0].trim()),
					y: Number(node.cropimage.split(",")[1].trim()),
					w: Number(node.cropimage.split(",")[2].trim()),
					h: Number(node.cropimage.split(",")[3].trim())
				}
			} else {
				node.cropimage = "";
			}
		}
		node.variabilizeManipulation(config);

		// 14/12/2020 Get the picture image from camera
		RED.httpAdmin.get("/hikvisionUltimateGetPicture", RED.auth.needsPermission('hikvisionUltimatePicture.read'), function (req, res) {
			if (typeof req.query.serverID !== "undefined" && req.query.serverID !== null && req.query.serverID !== "") {
				var _nodeServer = RED.nodes.getNode(req.query.serverID);// Retrieve node.id of the config node.
				// Create the config object
				//#region CREATING CONFIG
				// var sManipulate = $("#node-input-channelID").val();
				// sManipulate += "SEP" + $("#node-input-qualityimage").val();
				// sManipulate += "SEP" + $("#node-input-rotateimage").val();
				// sManipulate += "SEP" + $("#node-input-widthimage").val();
				// sManipulate += "SEP" + $("#node-input-heightimage").val();
				// sManipulate += "SEP" + $("#node-input-cropimage").val().toString().trim().replace(/\s/g, '').replace(/,/g,"-");
				var sManipulate = req.query.manipulate;
				var oConfig = { channelID: sManipulate.split("SEP")[0].toString().trim() };
				oConfig.qualityimage = sManipulate.split("SEP")[1].toString().trim();
				oConfig.rotateimage = sManipulate.split("SEP")[2].toString().trim();
				oConfig.widthimage = sManipulate.split("SEP")[3].toString().trim();
				oConfig.heightimage = sManipulate.split("SEP")[4].toString().trim();
				oConfig.cropimage = sManipulate.split("SEP")[5].toString().trim().replace(/-/g, ",");
				node.variabilizeManipulation(oConfig);
				//#endregion
				//console.log("MAN " + JSON.stringify(oConfig))
				if (_nodeServer === null) {
					res.json({ picture: "", width: 0, height: 0 });
				} else {
					node.picture = null;
					node.server = _nodeServer;
					// Call the request, that then sends the result via node.sendPayload function
					node.server.request(node, "GET", "/ISAPI/Streaming/channels/" + node.channelID + "01/picture", null).then(success => {
						// Wait until the server has called node.sendPayload and node.sendPayload has populated the node.picture variable
						var iTimeout = 0;
						var CB = () => {
							iTimeout += 1;
							if (iTimeout >= 15) {
								res.json({ picture: "", width: " !Error getting picture Timeout! ", height: 0 });
								return;
							} else {
								if (node.picture !== null) {
									res.json({ picture: node.picture, width: node.pictureLarghezza, height: node.pictureAltezza });
									return;
								}
								setTimeout(CB, 500);
							}
						}
						setTimeout(CB, 500);

					}).catch(error => {
						res.json({ picture: "", width: " !Error getting picture! ", height: " !" + error.message + "! "});
					});
				}
			} else { res.json({ picture: "", width: 0, height: 0 }); }
		});

		// Get picture 
		node.getPicture = (_picBase64) => new Promise(function (resolve, reject) {
			try {
				jimp.read(_picBase64)
					.then(image => {
						if (node.rotateimage !== 0) image = image.rotate(Number(node.rotateimage));
						if (node.cropimage !== "") image = image.crop(node.cropimage.x, node.cropimage.y, node.cropimage.w, node.cropimage.h);
						if (node.heightimage !== "0" && node.widthimage !== "0") image = image.resize(Number(node.widthimage), Number(node.heightimage));
						if (node.qualityimage !== 100) image = image.quality(Number(node.qualityimage));
						node.pictureLarghezza = image.bitmap.width;
						node.pictureAltezza = image.bitmap.height;
						image.getBufferAsync(jimp.MIME_JPEG).then(picture => {
							node.picture = "data:image/jpg;base64," + picture.toString("base64");
							resolve(node.picture);
						}).catch(error => {
							reject(error);
						});
					});
			} catch (error) {
				reject(error);
			}
		});


		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg]); return; }; // It's a connection error/restore comunication.
			if (_msg.hasOwnProperty("payload")) {
				if (_msg.payload.hasOwnProperty("eventType")) {
					// Chech if it's only a hearbeat alarm
					try {
						var sAlarmType = _msg.payload.eventType.toString().toLowerCase();
						if (sAlarmType === "videoloss" && _msg.payload.hasOwnProperty("activePostCount") && _msg.payload.activePostCount == "0") {
							node.setNodeStatus({ fill: "green", shape: "ring", text: "Received HeartBeat (the device is online)" });
							return; // It's a Heartbeat
						}
					} catch (error) { }
				}
			};

			node.getPicture(_msg.payload).then(data => {
				_msg.payload = data;
				node.send(_msg, null);
				node.setNodeStatus({ fill: "green", shape: "dot", text: "Picture received" });
			}).catch(error => {
				node.setNodeStatus({ fill: "red", shape: "dot", text: "GetBuffer error: " + error.message });
			})


		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

		this.on('input', function (msg) {
			if (msg === null || msg === undefined) return;
			if (msg.hasOwnProperty("payload") && msg.hasOwnProperty("payload") !== null && msg.hasOwnProperty("payload") !== undefined) {
				if (msg.payload === true) {
					// Recall PTZ Preset
					// Params: _callerNode, _method, _URL, _body
					try {
						// Call the request, that then sends the result via node.sendPayload function
						node.server.request(node, "GET", "/ISAPI/Streaming/channels/" + node.channelID + "01/picture", null);
					} catch (error) {

					}
				}
			}

		});

		node.on("close", function (done) {
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimatePicture", hikvisionUltimatePicture);
}
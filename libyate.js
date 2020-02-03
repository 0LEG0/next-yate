/**
 * @file "Next-Yate" libyate.js
 * @author Anton <aucyxob@gmail.com>
 * @version 0.0.2
 * @license Apache-2.0
 * @description <h3>Next-Yate is Nodejs interface library to the Yate external module (Yet Another Telephony Engine).</h3>
 * It contains two APIs to Yate:<br/>
 * 1. The first core API is, in fact, the Nodejs version rewritten from the official PHP library libyate.php and represented by classes:<br/>
 * <ul>
 * <li> Yate </li>
 * <li> Message </li>
 * </ul>
 * 2. The second compatible API is my attempt to ensure API compatibility with the  Yate's JavaScript module https://docs.yate.ro/wiki/Javascript_module.
 * This API allows you to run scripts written for javascript.yate module in Nodejs environment with minimal modifications.
 * To use the compatible API, you need to request following objects from the getEngine function:<br/>
 * <ul>
 * <li> Engine </li>
 * <li> Message </li>
 * </ul>
 * @see https://github.com/0LEG0/next-yate
 * @see https://docs.yate.ro/wiki/Javascript_Reference
 */
"use strict";

// imports
const { Console } = require("console");
const { Writable } = require("stream");
const { Socket } = require("net");
const { EventEmitter } = require("events");
const { createInterface } = require("readline");

// defaults
const _TRACKNAME = "next-yate";
const _BUFFER_SIZE = 8190; // default 8192
const _DISPATCH_TIMEOUT = 3000; // default 10000
const _ACKNOWLEDGE_TIMEOUT = 3000; // default 10000
const _RECONNECT_TIMEOUT = 10000;
const _PORT = 5040;
//const _HOST = "127.0.0.1";
const _OFFLINE_QUEUE = 100; // default 10

/**
 * Creates compatible API objects Engine and Message
 * like in the Yate's official JavaScript API https://docs.yate.ro/wiki/Javascript_Reference .
 * All of these are connected to the specific Yate extmodule and ready to work just after creation.
 * @function
 * @global
 * @param {Object} options - options for network connection
 * @returns {(Engine|_Message)} {Engine, Message}
 * @see Engine
 * @see _Message
 * @example
 * const {getEngine} = require("next-yate");
 * const {Engine, Message} = getEngine({host: "127.0.0.1"});
 * Engine.output("Hello World!");
 */
function getEngine(options) {
	let _yate = new Yate(options);
	let _dstream = new DumpStream();
	let _dconsole = new Console(_dstream);

	if (!_yate._host) console = _yate.getConsole();
	_yate.on("_debug", console.log);
	_yate.init();

	/**
	 * _Message is part of compatible API.
	 * Unlike Message class of core API it has static methods: install, watch, uninstall, unwatch and own methods: enqueue and dispatch.
	 * @constructs
	 * @name _Message
	 * @param {string} name - name of message (required)
	 * @param {boolean} broadcast - (not used)
	 * @param {Object} params - paramerers (optional)
	 * @returns {Message}
	 * @see https://docs.yate.ro/wiki/Javascript_Message
	 * @see getEngine
	 * @example
	 * const {Engine, Message} = getEngine();
	 * let m = new Message("engine.status");
	 * let status = await m.dispatch();
	 */
	const _Message = function(name, broadcast, params) {
		let message = new Message(name, broadcast, params);
		/**
		 * @memberof _Message
		 * @instance
		 * @method enqueue
		 * @see Yate#enqueue
		 */
		message.enqueue = () => _yate.enqueue(this);
		/**
		 * @memberof _Message
		 * @instance
		 * @method dispatch
		 * @async
		 * @see Yate#dispatch
		 */
		message.dispatch = async function() {
			return _yate.dispatch(this);
		};

		return message;
	};
	//_Message.__proto__ = _yate;
	/**
	 * @method _Message.install
	 * @see Yate#install
	 */
	_Message.install = (...args) => _yate.install(...args);
	/**
	 * @method _Message.uninstall
	 * @see Yate#uninstall
	 */
	_Message.uninstall = (...args) => _yate.uninstall(...args);
	/**
	 * @method _Message.watch
	 * @see Yate#watch
	 */
	_Message.watch = (...args) => _yate.watch(...args);
	/**
	 * @method _Message.unwatch
	 * @see Yate#unwatch
	 */
	_Message.unwatch = (...args) => _yate.unwatch(...args);
	//_Message.handlers; TODO
	//_Message.installHook; TODO
	//_Message.uninstallHook; TODO
	/**
	 * @method _Message.trackName
	 * @see Yate#setlocal
	 */
	_Message.trackName = (arg) => {
		_yate.setlocal( () => {	_yate._trackname = arg	}, "trackparam", arg );
	};

	/**
	 * Compatible API object Engine
	 * @namespace Engine
	 * @static
	 * @see https://docs.yate.ro/wiki/Javascript_Engine
	 * @example
	 * const { getEngine } = require("next-yate");
	 * const { Engine, Message } = getEngine();
	 * Engine.output("Hello World!");
	 */
	const Engine = {
		DebugFail: 0, 0: "FAIL",
		DebugTest: 1, 1: "TEST",
		DebugCrit: 2, 2: "CRIT",
		DebugGoOn: 2,
		DebugConf: 3, 3: "CONF",
		DebugStub: 4, 4: "STUB",
		DebugWarn: 5, 5: "WARN",
		DebugMild: 6, 6: "MILD",
		DebugNote: 7, 7: "NOTE",
		DebugCall: 8, 8: "CALL",
		DebugInfo: 9, 9: "INFO",
		DebugAll: 10, 10: "ALL"
	};
	//Engine.shared TODO
	Engine.name = process.argv[1];
	Engine._debugLevel = 8;
	Engine._debugName = _yate._trackname;
	Engine._debug = true;
	/**
	 * Returns internal connection object of Yate
	 * @method Engine.getConnection
	 * @returns {Yate}
	 * @see Yate
	 */
	Engine.getConnection = () => _yate;
	/**
	 * Set/Get Engine specific parameter
	 * @method Engine.setLocal
	 * @async
	 * @see Yate#setlocal
	 */
	Engine.setLocal = function(...args) { return _yate.setlocal(...args) } ;
	/**
	 * Returns the set of Engine's specific parameters
	 * @method Engine.getEnvironment
	 * @async
	 * @see Yate#getEnvironment
	 */
	Engine.getEnvironment = function(...args) { return _yate.getEnvironment(...args) };
	/** @method Engine.output */
	Engine.output = (...args) => _yate.output(args.join(" "));
	/** @method Engine.debug */
	Engine.debug = (level, ...args) => {
		if (typeof level === "number"  && level > -1 && Engine._debug && Engine._debugLevel >= level)
			Engine.output(new Date().toISOString(),	`<${Engine._debugName}:${Engine[level]}>`, ...args);
	};
	/** @method Engine.alarm */
	Engine.alarm = (level, ...args) => {
		if (typeof level === "string" && typeof args[0] === "number") {
			level = args[0];
			args.splice(0, 1);
		}
		if (typeof level === "number" && level > -1 && level < 11) {
			Engine.output(new Date().toISOString(),	`<${Engine._debugName}:${Engine[level]}>`, ...args);
		}
	};
	/**
	 * @method Engine.sleep
	 * @param {number} seconds
	 * @async
	 */
	Engine.sleep = function(sec) {
		return new Promise(res => {
			setTimeout(res, sec * 1000);
		});
	};
	/**
	 * @method Engine.usleep
	 * @param {number} milliseconds
	 * @async
	 */
	Engine.usleep = function(usec) {
		return new Promise(res => {
			setTimeout(res, Math.floor(usec / 1000));
		});
	};
	Engine.yield = () => {}; // not used
	Engine.idle = () => {}; // not used
	//Engine.restart = () => {}; TODO
	/**
	 * @method Engine.dump_r
	 * @async
	 */
	Engine.dump_r = (...args) => {
		// based on JSON.stringify
		//return args.reduce( (prev, item) => (prev += JSON.stringify(item, null, 2)), "");
		// based on async console output
		return new Promise( resolve => {
			_dstream.once("dump", resolve);
			_dconsole.log(...args);	
		});
	};
	/** @method Engine.print_r */
	Engine.print_r = (...args) => _yate.getConsole().log(...args);
	/**
	 * @method Engine.dump_t
	 * @async
	 */
	Engine.dump_t = (...args) => {
		return new Promise( resolve => {
			_dstream.once("dump", resolve);
			_dconsole.table(...args);	
		});
	};
	/** @method Engine.print_t */
	Engine.print_t = (...args) => _yate.getConsole().table(...args);
	/** @method Engine.debugName */
	Engine.debugName = (name) => {
		if (typeof name === "string") Engine._debugName = name;
		else return Engine._debugName;
	};
	/** @method Engine.debugLevel */
	Engine.debugLevel = (level) => {
		if (typeof level === "number") Engine._debugLevel = level;
		else return Engine._debugLevel;
	};
	/** @method Engine.debugEnabled */
	Engine.debugEnabled = (value) => {
		if (typeof level === "boolean") Engine._debug = value;
		else return Engine._debug;
	};
	/** @method Engine.debugAt */
	Engine.debugAt = (level) => (level <= Engine._debugLevel);
	/** @method Engine.setDebug */
	Engine.setDebug = function(command) {
		// TODO
		if (typeof command === "boolean") Engine._debug = command;
	};
	/** @method Engine.started */
	Engine.started = () => _yate._connected;
	//Engine.runParams TODO
	//Engine.configFile TODO
	/** @method Engine.setInterval */
	Engine.setInterval = (...args) => setInterval(...args);
	/** @method Engine.setTimeout */
	Engine.setTimeout = (...args) => setTimeout(...args);
	/** @method Engine.clearInterval */
	Engine.clearInterval = (id) => clearInterval(id);
	/** @method Engine.clearTimeout */
	Engine.clearTimeout = (id) => clearTimeout(id);
	/** @method Engine.replaceParams */
	Engine.replaceParams = function(buf, params) {
		// TODO (buf, params, sqlEscape, extraEsc)
		// eslint-disable-next-line no-useless-escape
		let str = buf.split(/(\$\{[^\$\{\}]+\})/);
		let res = [];
		for (let i = 0; i < str.length; i++) {
			let key = str[i].match(/\$\{(.+)\}/);
			if (key !== null) {
				if (key[1] in params) res.push(params[key[1]]);
			} else res.push(str[i]);
		}
		return res.join("");
	};
	/** @method Engine.atob */
	Engine.atob = (encoded) => Buffer.from(encoded, "base64");
	/** @method Engine.btoa */
	Engine.btoa = (line) => Buffer.from(line).toString("base64");
	//Engine.atoh TODO
	//Engine.htoa TODO
	//Engine.btoh TODO
	//Engine.htob TODO

	return { Engine, Message: _Message };
}

/**
 * Message class is part of core API.
 * Unlike _Message class of compatible API does not contain static methods install/uninstall/watch/unwatch and methods enqueue and dispatch.
 * @class
 * @param {string} name - message name (required)
 * @param {boolean} broadcast (not used)
 * @param {Object} params - message parameters (optional, for example {id: "sip/123", caller: "12345", called: "67890"})
 * @example
 * const {Yate, Message} = require("next-yate");
 * let yate = new Yate();
 * let m = new Message("call.drop", { id: "sip/123", reason: "timeout" });
 * yate.enqueue(m);
 * @see https://docs.yate.ro/wiki/Javascript_Message
 */
class Message {
	constructor(name, broadcast, params) {
		if (typeof name !== "string" || name.length < 1) throw new Error("Message name are required!");
		if (typeof broadcast === "boolean") this._broadcast = broadcast;
		if (typeof broadcast === "object" && broadcast) params = broadcast;
		this._name = name;
		this._time = Math.floor(Date.now() / 1000); //sec
		this._id = `${this._time}${process.hrtime()[1]}`;
		this._type = "outgoing";
		this._processed = false;
		this.copyParams(params);
	}

	get name() { return function() { return this._name } } // workaround
	set name(value) { this._name = value }
	get broadcast() { return function() { return this._broadcast } } // workaround
	set broadcast(value) { this._broadcast = value }

	/**
	 * @method
	 * @param {string} name - Name of the parameter to retrieve (requred)
	 * @param {any} defValue - Value to return if parameter is missing, default undefined
	 * @param {boolean} autoNumber - Automatically convert parameters to boolean or number type, default true
	 * @return {any} Value of parameter, even if name matches a method name
	 */
	getParam(name, defValue, autoNumber) {
		if (name === "name") return this._name; // workaround
		if (name === "broadcast") return this._broadcast; // workaround
		if (this[name] === "undefined") return defValue;
		return autoNumber ? this[name] : this[name] + "";
	}
	/**
	 * @method
	 * @param {string} name - Name of the parameter to set
	 * @param {any} value - New value to set in parameter, undefined to delete the parameter
	 * @returns {boolean} True on success, false if message was not in a state where parameters can be changed
	 */
	setParam(name, value) {
		if (("" + name).charAt(0) === "_") return false;
		this[name] = value;
		return true;
	}
	/**
	 * @method
	 * @param {Object} obj - object from which to copy properties (except objects, null and undefined)
	 * @param {string} prefix - (not used)
	 * @param {string} skip - (not used)
	 */
	copyParams(obj) {
		// TODO copyParams(obj, prefix, skip)
		/* TODO:
		 * obj - object from which to copy properties (except objects, null and undefined)
		 * prefix - optional parameter to specify that only properties that a key with the given index should be copied. If the prefix represents an object, the properties of that object will be copied.
		 * skip - optional parameter (assumed, by default, to be true) to specifies if the prefix should be copied or eliminated from the key being copied.
		 */
		if (!obj) return;
		if (typeof obj !== "object") return;
		_deepCopy(this, obj);
	}
	/**
	 * @method
	 * @param {string} value - New returned value to set in the message, if undefined method returns "Returned value of the message"
	 * @returns {string} - Returned value of the message
	 */
	retValue(value) {
		if (value === undefined) return this._retvalue;
		this._retvalue = value;
	}
	/**
	 * @method
	 * @returns {number} - Message creation time in milliseconds since EPOCH
	 */
	msgTime() {	return this._time }
	getColumn() {} // TODO
	getRow() {} // TODO
	getResult() {} // TODO
}
Object.defineProperties(Message.prototype, {
	getParam: { writable: false },
	setParam: { writable: false },
	copyParams: { writable: false },
	retValue: { writable: false },
	msgTime: { writable: false },
	getColumn: { writable: false },
	getRow: { writable: false },
	getResult: { writable: false }
});

/**
 * Yate class is part of core API.
 * It provides connection to Yate's external module.
 * @class Yate
 * @param {Object} options (optional)
 * @param {string} options.host Address of listerning Yate's extmodule (for example "127.0.0.1")
 * @param {number} options.port (default 5040)
 * @param {string} options.path Socket path (default undefined)
 * @param {string} options.trackname Sets the track name of your script. (required, default value "next-yate")
 * @param {boolean} options.reconnect Try to reconnect in collisions. (default true)
 * @param {number} options.reconnnect_timeout Reconnect tries interval in milliseconds. (default 10000)
 * @param {number} options.dispatch_timeout Drops the response from Yate after dispatch_timeout in milliseconds, so that your code does not hang waiting endlessly for an answer. (default 3000)
 * @param {number} options.acknowledge_timeout Reply to the message without processing after a specified time, so as not to overload the Yate queue and not cause the engine to crash. (default 3000)
 * @param {number} options.bufsize Sets the maximum size of transferred query data in extmodule. (default 8190).
 * @example
 * const {Yate, Message} = require("next-yate");
 * let yate = new Yate({host: "127.0.0.1", trackname: "myscript"});
 * yate.init();
 * @see https://docs.yate.ro/wiki/External_module_command_flow
 */
class Yate extends EventEmitter {
	constructor(options) {
		super();

		if (typeof options !== "object") options = {};

		this._socket = null;
		this._connected = false;
		this._debug = "debug" in options ? options.debug : false;
		this._host = options.host; // "127.0.0.1"
		this._port = options.port ? options.port : _PORT;
		this._path = options.path; // "socket path"
		this._reconnect = "reconnect" in options ? options.reconnect : true;
		this._reconnnect_timeout = options.reconnnect_timeout ? options.reconnnect_timeout : _RECONNECT_TIMEOUT;
		this._dispatch_timeout = options.dispatch_timeout ? options.dispatch_timeout : _DISPATCH_TIMEOUT;
		this._acknowledge_timeout = options.acknowledge_timeout ? options.acknowledge_timeout : _ACKNOWLEDGE_TIMEOUT;
		this._bufsize = options.bufsize ? options.bufsize : _BUFFER_SIZE;
		this._trackname = options.trackname ? options.trackname : _TRACKNAME;
		this.setMaxListeners(options.queue ? options.queue : _OFFLINE_QUEUE);

		// {name, value}
		this._setlocals = [
			{ name: "trackparam", value: this._trackname },
			{ name: "bufsize", value: this._bufsize },
			{ name: "restart", value: this._reconnect },
			{ name: "timeout", value: this._acknowledge_timeout }
		];

		// {callback, name, priority, filter, fvalue}
		this._installs = [];
		// {callback, name}
		this._watches = [];

		// Dumped stream
		this._dump = new DumpStream();
		this._dump.on("dump", dump => this.output(dump));
		// Console -> Dumped stream -> Yate.output
		this._console = new Console(this._dump);

		if (!this._host) {
			// local streams
			this.in = process.stdin;
			this.out = process.stdout;
			this._reconnect = false;
			console = this._console; // console -> Yate.output
			this._restore();
		} else {
			// do not reconnect on exit
			process.on("SIGINT", () => {
				if (this._socket) this._socket.end();
				this._reconnect = false;
				this.removeAllListeners();
				setTimeout(process.exit, 100);
			});
		}
	}

	/**
	 * Connecting to extmodule
	 * @method
	 * @param {function} callback
	 * @example
	 * let yate = new Yate();
	 * yate.init(function() { console.log("Connnected") });
	 */
	init(callback) {
		if (!this._host) {
			// local start
			this._restore(callback); // <-- start here
			return;
		}
		if (this._connected) return;
		if (this.timer) clearTimeout(this.timer);

		this._socket = new Socket(); // network start

		this._socket.on("connect", () => {
			this.in = this.out = this._socket;
			this._restore(callback); // <-- or start here
		});

		this._socket.on("end", () => {
			this._connected = false;
			this.emit("_disconnect");
			if (this._reconnect)
				this.timer = setTimeout(() => {
					this.init();
				}, this._reconnnect_timeout);
		});

		this._socket.on("error", error => {
			this._connected = false;
			if (this._reconnect) {
				this.timer = setTimeout(() => {
					this.init(callback);
				}, this._reconnnect_timeout);
			} else {
				this.emit("_error", error);
			}
		});

		this._socket.connect({
			path: this._path,
			port: this._port,
			host: this._host,
			timeout: this.timeout
		});
	}

	// restore handlers
	_restore(callback) {
		if (this._connected) return;
		this._connected = true;
		let rl = createInterface(this.in);
		rl.on("line", line => {
			this._read(line);
		});
		// restore: setlocal, install & watch
		this._setlocals.forEach(item => {
			this._setlocal(item.name, item.value);
		});
		this._installs.forEach(item => {
			this.removeAllListeners(item.name);
			this.install(item.callback, item.name, item.priority, item.filter, item.fvalue);
		});
		this._watches.forEach(item => {
			this.removeAllListeners(item.name);
			this.watch(item.callback, item.name, item.priority, item.filter, item.fvalue);
		});
		this.emit("_connect"); //setTimeout(() => { this.emit("_connect") }, 100);
		if (typeof callback === "function") callback();
	}

	/**
	 * Returns Console outputs to Yate's log
	 * @method
	 * @returns {Console}
	 * @example
	 * yate.getConsole().log("Find this message in yate's log");
	 */
	getConsole() {
		return this._console;
	}

	/**
	 * Returns set of connection's specific parameners
	 * @method
	 * @example
	 * { version: '6.1.1',
	 *   release: 'devel1',
	 *   nodename: 'svn',
	 *   runid: '1580736088',
	 *   configname: 'yate',
	 *   sharedpath: './share',
	 *   configpath: './conf.d',
	 *   cfgsuffix: '.conf',
	 *   modulepath: './modules',
	 *   modsuffix: '.yate',
	 *   logfile: '',
	 *   clientmode: 'false',
	 *   supervised: 'false',
	 *   maxworkers: '10'
	 * }
	 * @param {function} callback 
	 * @async
	 */
	getEnvironment(callback) {
		let env = [ 
			"version", "release", "nodename", "runid", "configname",
			"sharedpath", "configpath", "cfgsuffix", "modulepath",
			"modsuffix", "logfile", "clientmode", "supervised", "maxworkers"
		];
		let ans = {};

		return Promise.all(
			env.map(key => {
				return new Promise(resolve => {
					this.setlocal(value => {
						ans[key] = value;
						resolve(value);
					}, "engine." + key);
				})
			})
		).then(() => {
			if (typeof callback === "function") callback(ans);
			return ans;
		});
	}

	/**
	 * Sets the handler to a specific message.
	 * The yate engine will wait for a response to its message.
	 * @method
	 * @param {function} callback - function to be message handler (required)
	 * @param {string} name - message name (required)
	 * @param {number} priority - priority of the handler, as low value as high proirity (optional, default 100)
	 * @param {string} filter - set the filter to message parameter (optional, for example "called")
	 * @param {string} fvalue - filter value (optional, for example "^9999.*")
	 * @example
	 * const {Yate, Message} = require("next-yate");
	 *
	 * function onRoute(message) {
	 *     message.retValue("tone/ring"); // send the incoming call to tone/ring module
	 * }
	 *
	 * let yate = new Yate();
	 * yate.init();
	 * yate.install(onRoute, "call.route", 90, "called", "^9999.*"); // set the handler to "call.route" messages where parameter message.called begins with "9999", handler has priority 90
	 * @see Message
	 * @see https://docs.yate.ro/wiki/Standard_Messages
	 */
	install(callback, name, priority, filter, fvalue) {
		if (typeof callback === "function" && typeof name === "string") {
			// 1. query yate to install the handler
			this._install(name, priority, filter, fvalue);
			// 2. waiting for answer
			this.once("_install," + name, success => {
				// 3. on successful answer set the callback handler
				if (!success) return;
				// replace existing handler or append new one
				let idx = this._installs.length;
				for (let i = 0; i < this._installs.length; i++) {
					if (this._installs[i].name === name) {
						idx = i;
						break;
					}
				}
				this._installs[idx] = {
					callback: callback,
					name: name,
					priority: priority,
					filter: filter,
					fvalue: fvalue
				};
				this.on(name, message => {
					// 4. promisify the (callback + acknowledge) )
					let calltype = Object.getPrototypeOf(callback).constructor.name;
					let promise; // it can be promise
					if (calltype === "AsyncFunction" || calltype === "Promise")	promise = callback;
					else promise = (msg) =>	new Promise( (resolve) => { resolve(callback(msg))	});
					// 5. attach acknowledge
					return promise(message).then( (ans) => {
							if (typeof ans === "boolean") {
								// if answer is boolean -> message.processed -> ack
								message._processed = ans;
								this._acknowledge(message);
								return;
							}
							if (ans && typeof ans === "object") {
								// if answer is changed message -> ack
								if (ans._id === message._id) {
									this._acknowledge(ans);
									return;
								}
							}
                            this._acknowledge(message); // EVERY message must be acknowledged!
                            
						}).catch(() => this._acknowledge(message)); // ...on error too
				});
			});
		}
	}

	/**
	 * Removes the install handler from a specific yate message
	 * @method
	 * @param {string} name - message name (required)
	 * @example
	 * yate.uninstall("call.route");
	 * @see Yate#install
	 */
	uninstall(name) {
		if (typeof name === "string") {
			this.once("_uninstall," + name, success => {
				if (!success) return;
				this.removeAllListeners(name);
				for (let i = 0; i < this._installs.length; i++)
					if (this._installs[i].name === name) {
						delete this._installs[i];
						break;
					}
			});
			this._uninstall(name);
		}
	}

	/**
	 * Sets the handler to a specific yate message.
	 * In contrast to the method of Yate.install it does not require an answer to message. You will get already handled messages.
	 * @method
	 * @param {function} callback - function to be message handler (required)
	 * @param {string} name - message name (required)
	 * @example
	 * const {Yate, Message} = require("next-yate");
	 *
	 * function onTimer(message) {
	 *     concole.log(message.time);
	 * }
	 *
	 * let yate = new Yate();
	 * yate.init();
	 * yate.watch(onTimer, "engine.timer");
	 * @see https://docs.yate.ro/wiki/Standard_Messages
	 */
	watch(callback, name) {
		if (typeof callback === "function" && typeof name === "string") {
			this.once("_watch," + name, success => {
				if (!success) return;
				this.on(name, callback);
				//
				let idx = this._watches.length;
				for (let i = 0; i < this._watches.length; i++)
					if (this._watches[i].name === name) {
						idx = i;
						break;
					}
				this._watches[idx] = { callback: callback, name: name };
				//
			});
			this._watch(name);
		}
	}

	/**
	 * Removes the watch handler from a specific yate message
	 * @method
	 * @param {string} name - message name (required)
	 * @example
	 * yate.unwatch("engine.timer");
	 * @see Yate#watch
	 */
	unwatch(name) {
		if (typeof name === "string") {
			this.once("_unwatch," + name, success => {
				if (!success) return;
				this.removeAllListeners(name);
				for (let i = 0; i < this._watches.length; i++)
					if (this._watches[i].name === name) {
						delete this._watches[i];
						break;
					}
			});
			this._unwatch(name);
		}
	}

	/**
	 * Set/change/read extmodule connection parameters.
	 * @method
	 * @param {function} callback - result handler (optional, if undefined returns promisyfied value)
	 * @param {string} name - parameter name (required)
	 * @param {string} value - parameter value (optional, if undefined the method returns the parameter value)
	 * @async
	 * @example
	 * const {Yate, Message} = require("next-yate");
	 * let yate = new Yate();
	 * yate.init();
	 * // callback variant
	 * yate.setlocal(console.log, "engine.version"); // output value to console
	 * // or async/await variant
	 * let ver = await yate.setlocal("engine.version");
	 * console.log(ver);
	 * @see https://docs.yate.ro/wiki/External_module_command_flow
	 */
	setlocal(callback, name, value) {
		// callback version
		if (
            typeof callback === "function" && typeof name === "string" &&
            (typeof value === "string" || typeof value === "boolean" || typeof value === "number" || value === undefined)
        ) {
			this.once("_setlocal," + name, (ans) => {
				// push or replace to setlocals []
				if (value !== undefined && ans._success) {
					let idx = this._setlocals.length;
					for (let i = 0; i < this._setlocals.length; i++) {
						if (this._setlocals[i].name === name) {
							idx = i;
							break;
						}
					}
					this._setlocals[idx] = { name: name, value: value };
				}
				callback(ans._success ? ans._retvalue : undefined );
			});
			this._setlocal(name, value);
			return;
		}
		// or promise version without callback
		if ( typeof callback === "string" &&
			(typeof name === "string" || typeof name === "boolean" || typeof name === "number" || value === undefined)
		) {
			value = name;
			name = callback;
			return new Promise( (resolve) => {
				this._setlocal(name, value);
				let event = "_setlocal," + name;
				// kill the slow setlocal query by timeout
				let timeout = setTimeout(() => {
					this.removeListener(event, resolve);
					resolve(undefined);
				}, this._dispatch_timeout);

				this.once(event, (ans) => {
					clearTimeout(timeout);
					// push or replace to setlocals []
					if (value !== undefined && ans._success) {
						let idx = this._setlocals.length;
						for (let i = 0; i < this._setlocals.length; i++) {
							if (this._setlocals[i].name === name) {
								idx = i;
								break;
							}
						}
						this._setlocals[idx] = { name: name, value: value };
					}
					resolve(ans._success ? ans._retvalue : undefined );
				});
			});
		}
	}

	/**
	 * Enqueues the Message in the Yate engine
	 * @method
	 * @param {Object} message - Message (required)
	 * @example
	 * const {Yate, Message} = require("next-yate");
	 * let yate = new Yate();
	 * yate.init();
	 * let m = new Message("call.drop", false, { id: "sip/123" });
	 * yate.equeue(m);
	 */
	enqueue(message) {
		this._dispatch(message);
	}

	/**
	 * Dispatches the Message in the Yate engine
	 * @method
	 * @param {Function} callback - Callback function (optional, if undefined returns promisyfied value)
	 * @param {Object} msg - Message (required)
	 * @async
	 * @example
	 * const {Yate, Message} = require("next-yate");
	 * let yate = new Yate();
	 * yate.init();
	 * // callback variant
	 * let m = new Message("call.route", false, { id: "test/1", caller: "123", called: "321" });
	 * yate.dispatch(res => console.log(res.retValue()), m); // Output to console call.route request result
	 * // or async/await variant
	 * let res = await yate.dispatch(m);
	 * console.log(res.retValue());
	 */
	dispatch(callback, msg) {
		// callback version
		if (typeof callback === "function" && msg) {
			if ("_id" in msg && "_name" in msg && "_time" in msg) {
				this._dispatch(msg);
				this.once("_answer," + msg._id, callback);
			}
			return;
		}
		// promise version without callback
		if (callback && typeof callback === "object") {
			if ( "_id" in callback && "_name" in callback && "_time" in callback ) {
				msg = callback;
				return new Promise(resolve => {
					this._dispatch(msg);
					let event = "_answer," + msg._id;
					// kill the slow dispatch by timeout
					let timeout = setTimeout(() => {
						this.removeListener(event, resolve);
						msg._processed = false;
						resolve(msg);
					}, this._dispatch_timeout);
					this.once(event, (m) => {
						clearTimeout(timeout);
						resolve(m);
					});
				});
			}
		}
	}

	/**
	 * Output data to Yate log.
	 * @method
	 * @param {string} line
	 */
	output(line) {
		//("" + line).replace("\r\n", "\n").replace("\r", "\n").split("\n").forEach(l => this._output(l)); // CRLF -> LF
		("" + line).split("\n").forEach(l => this._output(l));
	}

	// External module command flow reader
	_read(line) {
		if (this._debug) this.emit("_debug", "<- " + line);
		let msg = _parseMessage(line);
		switch (msg._type) {
			case "error":
				this.emit("_error", msg._retvalue);
				break;
			case "setlocal":
				this.emit("_setlocal," + msg._name, msg);
				break;
			case "incoming":
				this.emit(msg._name, msg); // installed
				break;
			case "uninstall":
				this.emit("_uninstall," + msg._name, msg._success);
				break;
			case "notification":
				this.emit(msg._name, msg); // watched
				break;
			case "install":
				this.emit("_install," + msg._name, msg._success);
				break;
			case "answer":
				this.emit("_answer," + msg._id, msg); // dispatched
				break;
			case "watch":
				this.emit("_watch," + msg._name, msg._success);
				break;
			case "unwatch":
				this.emit("_unwatch," + msg._name, msg._success);
		}
	}

	/*
	 * External module protocol, direction application -> engine
	 */
	_write(line) {
		if (line.length > this.bufsize) line = line.substr(0, this.bufsize); // trim the line to max buffer size
		if (!this._connected) {
			// scheduled line
			this.once("_connect", () => { this._write(line) });
		} else {
			if (this._debug) this.emit("_debug", "-> " + line);
			this.out.write(line.endsWith("\n") ? line : line + "\n");
		}
	}

	// %%>connect:<role>[:<id>][:<type>]
	_connect(role, id, type) {
		if (role.match(/^(global|channel|play|record|playrec)$/))
			this._write("%%>connect:" + role + ":" + _escape(id) + ":" + _escape(type));
	}

	// %%>output:arbitrary unescaped string
	_output(line) {
		if (line.length > this.bufsize) line = line.substr(0, this.bufsize); // trim the line to max buffer size
		// use its own out.write without debug! loops
		if (!this._connected) {
			// scheduled command
			this.once("_connect", () => { this._output(line) });
		} else {
			this.out.write("%%>output:" + _unescape(line.endsWith("\n") ? line : line + "\n"));
		}
	}

	// %%<message:<id>:<processed>:[<name>]:<retvalue>[:<key>=<value>...]
	_acknowledge(msg) {
		if (msg._type !== "incoming") return;
		this._write("%%<message:" + _escape(msg._id) + ":" + _bool2str(msg._processed) + "::" + _escape(msg._retvalue) + _par2str(msg));
	}

	// %%>setlocal:<name>:<value>
	_setlocal(name, value) { this._write("%%>setlocal:" + name + ":" + _escape(value)) }

	// %%>watch:<name>
	_watch(name) { this._write("%%>watch:" + _escape(name)) }

	// %%>unwatch:<name>
	_unwatch(name) { this._write("%%>unwatch:" + _escape(name)) }

	// %%>install:[<priority>]:<name>[:<filter-name>[:<filter-value>]]
	_install(name, priority, filter, fvalue) {
		priority = ("" + priority).match(/^\d+$/) ? priority : 100;
        if (filter && fvalue)
            this._write("%%>install:" + priority + ":" + _escape(name) + ":" + filter + ":" + fvalue);
        else
            this._write("%%>install:" + priority + ":" + _escape(name));
	}

	// %%>uninstall:<name>
	_uninstall(name) { this._write("%%>uninstall:" + _escape(name)) }

	// %%>message:<id>:<time>:<name>:<retvalue>[:<key>=<value>...]
	_dispatch(msg) {
		if (msg._type !== "outgoing") return;
		this._write("%%>message:" + _escape(msg._id) + ":" + msg._time + ":" + _escape(msg._name) + ":" + _par2str(msg));
	}
}

/*
 * Dump stream to string
 * Emits the event "dump" when dump is finished
 */
class DumpStream extends Writable {
	constructor(options) {
		super(options);
	}
	_write(chunk, encoding, callback) {
		let dump = "";
		dump += chunk;
		callback();
		this.emit("dump", dump);
	}
}

/*
 * External module protocol, direction application <- engine
 * https://docs.yate.ro/wiki/External_module_command_flow
 */
function _parseMessage(str) {
	let arg = str.split(":");
	let params = {};
	switch (arg[0]) {
		case "%%>message": // %%>message:<id>:<time>:<name>:<retvalue>[:<key>=<value>...]
			params._id = arg[1];
			params._time = arg[2];
			params._name = arg[3];
			params._retvalue = _unescape(arg[4]);
			params._type = "incoming";
			break;
		case "%%<message": // %%<message:<id>:<processed>:[<name>]:<retvalue>[:<key>=<value>...]
			params._id = arg[1];
			params._processed = _str2bool(arg[2]);
			params._name = arg[3];
			params._retvalue = _unescape(arg[4]);
			params._type = params._id ? "answer" : "notification";
			break;
		case "%%<install": // %%<install:<priority>:<name>:<success>
			params._priority = arg[1];
			params._name = arg[2];
			params._success = _str2bool(arg[3]);
			params._type = "install";
			break;
		case "%%<uninstall": // %%<uninstall:<priority>:<name>:<success>
			params._priority = arg[1];
			params._name = arg[2];
			params._success = arg[3];
			params._type = "uninstall";
			break;
		case "%%<watch": // %%<watch:<name>:<success>
			params._name = arg[1];
			params._success = _str2bool(arg[2]);
			params._type = "watch";
			break;
		case "%%<setlocal": // %%<setlocal:<name>:<value>:<success>
			params._name = arg[1];
			params._retvalue = _unescape(arg[2]);
			params._success = _str2bool(arg[3]);
			params._type = "setlocal";
			break;
		case "Error in":
		default:
			params._type = "error";
			params._retvalue = str;
	}
	// message param parser
	if (
		params._type === "incoming" ||
		params._type === "answer" ||
		params._type === "notification"
	) {
		let par = arg.slice(5);
		for (let i = 0; i < par.length; i++) {
			let pos = par[i].indexOf("=");
			if (pos > 0) {
				let key = par[i].substr(0, pos);
				params[_unescape(key)] = _unescape(par[i].substr(pos + 1));
			}
		}
		// parent.child -> parent { child }
		params = _str2obj(params);
	}
	return new Message(params._name, params);
}

/*
 * Every command is sent on its own newline (\n, ^J, decimal 10) delimited line.
 * Any value that contains special characters (ASCII code lower than 32) MUST have them converted to %<upcode>
 * where <upcode> is the character with a numeric value equal with 64 + original ASCII code.
 * The % character itself MUST be converted to a special %% representation.
 * Characters with codes higher than 32 (except %) SHOULD not be escaped but may be so.
 * A %-escaped code may be received instead of an unescaped character anywhere except in the initial keyword or the delimiting colon (:) characters.
 * Anywhere in the line except the initial keyword a % character not followed by a character with a numeric value higher than 64 (40H, 0x40, "@") or another % is an error.
 */
function _escape(str, extra) {
	if (str === undefined || str === null) return "";
	str = str + ""; // all to string
	let res = "";
	for (let i = 0; i < str.length; i++) {
		let chr = str.charAt(i);
		if (chr.charCodeAt(0) < 32 || chr === ":" || chr === extra) {
			chr = String.fromCharCode(chr.charCodeAt(0) + 64);
			res += "%";
		} else if (chr === "%") {
			res += chr;
		}
		res += chr;
	}
	return res;
}

function _unescape(str) {
	let res = "";
	for (let i = 0; i < str.length; i++) {
		let chr = str.charAt(i);
		if (chr === "%") {
			i++;
			chr = str.charAt(i);
			if (chr !== "%") chr = String.fromCharCode(chr.charCodeAt(0) - 64);
		}
		res += chr;
	}
	return res;
}

// false -> "false"
function _bool2str(bool) {
	return bool ? "true" : "false";
}

// "true" -> true
function _str2bool(str) {
	return str === "true";
}

// stringify message params
function _par2str(msg, empty = false) {
	msg = _obj2str(msg);
	let res = "";
	for (let key in msg) {
		if (
			("" + key).charAt(0) === "_" ||
			typeof msg[key] === "object" ||
			typeof msg[key] === "function"
		)
			continue;
		let val = msg[key].toString();
		if (val) {
			res += ":" + _escape(key) + "=" + _escape(val);
		} else if (empty) {
			res += ":" + _escape(key);
		}
	}
	return res;
}

// stringify object
function _obj2str(obj, rootkey) {
	let res = {};
	let pref = rootkey ? rootkey + "." : "";
	for (let key in obj) {
		if (("" + key).charAt(0) === "_") continue;
		if (typeof obj[key] === "function") continue;
		if (typeof obj[key] === "object") {
			let subobj = _obj2str(obj[key], key);
			for (let subkey in subobj) {
				res[pref + subkey] = subobj[subkey];
			}
		} else {
			let val = obj[key].toString();
			if (rootkey === key) {
				res[key] = val;
			} else {
				res[pref + key] = val;
			}
		}
	}
	return res;
}

// parent.child -> parent: { child }
function _str2obj(obj) {
	let res = {};
	for (let key in obj) {
		let val = obj[key];
		if (val === "false") {
			val = false;
		} else if (val === "true") {
			val = true;
		}
		if (key.indexOf(".")) {
			key.split(".").reduce((object, key, index, arr) => {
				if (index === arr.length - 1) {
					if (typeof object === "object" && key in object) {
						object[key][key] = val;
					} else {
						object[key] = val;
					}
				} else {
					if (typeof object === "object" && key in object) {
						if (typeof object[key] !== "object") {
							object[key] = { [key]: object[key] };
						}
					} else {
						object[key] = {};
					}
				}
				return object[key];
			}, res);
		} else {
			res[key] = val;
		}
	}
	return res;
}

// object copy
function _deepCopy(dst, src) {
	for (let key in src) {
		//if (("" + key).charAt(0) === "_") continue; // don't allow to change _* Message parameter
		if (typeof src[key] === "function") continue;
		if (typeof src[key] !== "object") {
			dst[key] = src[key];
		} else {
			dst[key] = {};
			_deepCopy(dst[key], src[key]);
		}
	}
	return dst;
}

module.exports = {
	getEngine,
	Message,
	Yate
};

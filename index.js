/**
 * @file "Next-Yate"
 * @author Anton <aucyxob@gmail.com>
 * @version 0.1.0
 * @license Apache-2.0
 * @description Next-Yate is Nodejs External module for YATE (Yet Another Telephony Engine).
 * @see https://github.com/0LEG0/next-yate
 */
"use strict";

// imports
const { Console } = require("console");
const { Writable } = require("stream");
const { Socket } = require("net");
const { EventEmitter } = require("events");
const { createInterface } = require("readline");
const util = require("util");

// defaults
const _TRACKNAME = "next-yate";
const _BUFFER_SIZE = 8192; // default 8192
const _DISPATCH_TIMEOUT = 10000; // default 10000
const _ACKNOWLEDGE_TIMEOUT = 10000; // default 10000
const _RECONNECT_TIMEOUT = 10000;
const _CALL_TIMEOUT = 3600000; // 1 hour
const _PORT = 5040;
//const _HOST = "127.0.0.1";
const _OFFLINE_QUEUE = 100; // default 10

/**
 * YateChannel is an abstraction over incoming call leg.
 * It simplifyes most typical operations with call like attach media, answer/hangup, redirect and etc.
 * @class
 * @param {YateMessage} message - Only "call.route" or "call.execute" are supported (required)
 * @example
 * let chan = new YateChannel(incoming_message);
 * chan.init()
 *     .then(m => console.log("Channel", m.id, "initialized"))
 *     .then(() => chan.callTo("wave/play/./prompt.au"))
 *     .then(m => console.log("Channel", m.id, "prompted"))
 *     .then(() => chan.callJust("sip/sip:123@10.0.0.2"))
 *     .then(m => console.log("Channel", m.id, "redirected"));
 */
class YateChannel extends EventEmitter {
	constructor(message) {
		// TODO channel for outgoing call, now is only for incoming
		if (message.name !== "call.route" && message.name !== "call.execute" || message._type === "outgoing")
			throw new Error("Not valid message to create YateChannel");
		super();
		this.id = message.id;
		this.peerid = message.peerid;
		this._yate = message._yate; // parent Yate
		this.status = message.answered || message.autoanswer ? "answered" : message.status;

		message.earlymedia = true;
		
		if (message.name === "call.execute" && message._type === "notification") {
			this.ready = true; // to skip init()
		} else  {
			this.ready = false;
		}

		this._yate.watch(() => {}, "chan.notify", "id", this.id); // prevents watch/unwatch till channel lifetime
		
		// unsubscribe on hangup
		this._yate.watch(() => {
			this.ready = false;
			this.status = "hangup";
			this.removeAllListeners();
			this._yate._watches.forEach(item => {
				if (item.filterName === "id" && item.filterValue === this.id) this._yate.unwatch(item.handler, item.name, item.filterName, item.filterValue);
			});
			this._yate._installs.forEach(item => {
				if (item.filterName === "id" && item.filterValue === this.id) this._yate.uninstall(item.handler, item.name, item.priority, item.filterName, item.filterValue);
			});
		}, "chan.hangup", "id", this.id);
	}

	/**
	 * init() - initialize YateChannel before use.
	 * This method waits until the "call.execute" message arrives.
	 * @method
	 * @param {function} callback - (optional)
	 * @returns {Promise} - resolve(YateMessage), resolve(false) if timeout
	 * @async
	 */
	init(callback) {
		// if "ready" don't wait for call.execute
		if (this.ready) {
			return new Promise(resolve => {
				let message = {name: "call.execute", id: this.id, peerid: this.peerid, handled: true};
				if (typeof callback === "function") callback(message);
				resolve(message)
			});
		}

		return new Promise(resolve => {
			// reject by timeout
			let timer = setTimeout(() => {
				this._yate.unwatch("call.execute", "id", this.id);
				resolve(false);
			}, this._yate._dispatch_timeout);

			// wait call.execute
			this._yate.watch(message => {
				clearTimeout(timer);
				this._yate.unwatch("call.execute", "id", this.id);
				// update peerid
				this.peerid = message.peerid;
				this.status = message.answered || message.autoanswer ? "answered" : message.status;
				this.ready = true;
				if (typeof callback === "function") callback(message);
				resolve(message);
			}, "call.execute", "id", this.id);
		});
	}

	/**
	 * reset() - rejects active promise of channel.
	 * It's useful if you need to break the chain of promises
	 * @method
	 * @param {any} message (optional) 
	 * @returns {undefined}
	 */
	reset(message) {
		this.emit("reset", message);
	}

	/**
	 * callTo() is an abstraction over chan.attach message.
	 * @method
	 * @param {string} dst - is source for "wave/play/", consumer for "wave/record/" or override for "tone/" (required)
	 * @param {Object} params - parameters of chan.attach message (optional)
	 * @returns {Promise} - resolve(false) if channel is not ready or has not been initialized, resolve(YateMessage) with last message on complete
	 * @async
	 * @see http://docs.yate.ro/wiki/Chan.attach
	 */
	callTo(dst, params = {}) {
		if (!this.ready || typeof dst !== "string") return Promise.resolve(false);
		
		let notify = this._yate._trackname + "-notify/" + Date.now(); // <-- special targetid for notify handler
		let eof = true;
		let timeout;
		if (typeof params.timeout === "number") timeout = params.timeout;
		let attach = new YateMessage("chan.masquerade", {
            message: "chan.attach",
            id: this.peerid,
			notify: notify
		});

		if (dst.startsWith("wave/record")) {
			// wave/record
			attach.source = "wave/play/-";
			attach.consumer = dst;
			attach.maxlen = 180000; //default 10 sec
		} else if (dst.startsWith("tone/dtmf")) {
			// tone/dtmf
			attach.id = this.id;
			attach.override = dst;
			if (!timeout && dst.startsWith("tone/dtmfstr/")) {
				timeout = dst.slice(14).length * 250;
			} else {
				timeout = 250;
			}
			eof = false;
		} else {
			// wave/play, tone/
			attach.source = dst;
			attach.consumer = "wave/record/-";
		}

		if (typeof params === "object") attach.copyParams(params);

		return new Promise((resolve, reject) => {
			// reset
			this.once("reset", reject);
			// tone
			if (!eof) {
				this._yate.dispatch(attach)
					.then(message => { setTimeout(() => {message.reason = "eof"; resolve(message)}, timeout ? timeout : 250) });
				return;
			}

			// watcher
			let handler;
            this._yate.watch(handler = (message) => {
				clearTimeout(timer);
				this._yate.unwatch(handler, "chan.notify", "targetid", notify);
				resolve(message);
				this.removeListener("reset", reject);
			}, "chan.notify", "targetid", notify);
			// timeout
			let timer = setTimeout(() => {
				this._yate.unwatch(handler, "chan.notify", "targetid", notify);
				attach.reason = "eof";
				resolve(attach);
				this.removeListener("reset", reject);
			}, timeout ? timeout : this._yate._call_timeout);

			this._yate.enqueue(attach);
		});
	}

	/**
	 * callJust() is an abstraction over call.execute message.
	 * @method
	 * @param {string} dst - callto destination for call.execute message i.e. "sip/sip:xxx@1.2.3.4"
	 * @param {Object} params - parameters for call.execute message (optional)
	 * @returns {Promise} - resolve(false) if channel is not ready or has not been initialized, resolve(YateMessage) with handled "call.execute"
	 * @async
	 * @see http://docs.yate.ro/wiki/Call.execute
	 */
	callJust(dst, params) {
		if (!this.ready  || typeof dst !== "string") return Promise.resolve(false);

		let callto = new YateMessage("chan.masquerade", {
            message: "call.execute",
            id: this.id,
            callto: dst
		});
		if (typeof params === "object") callto.copyParams(params);
		
		return this._yate.dispatch(callto)
			.then(message => {
				// update peerid
				this.peerid = message.peerid;
				this.status = message.status;
				return message} );
	}

	/**
	 * ringing() is an abstraction over call.ringing message.
	 * @method
	 * @param {Object} params - parameters of call.ringing message (optional)
	 * @returns {Promise} - resolve(false) if channel is not ready or has not been initialized, resolve(YateMessage) with "call.ringing"
	 * @async
	 * @see http://docs.yate.ro/wiki/Call.ringing
	 */
	ringing(params) {
		if (!this.ready) return Promise.resolve(false);

		let ringing = new YateMessage("chan.masquerade", {
			message: "call.ringing",
			id: this.peerid,
			targetid: this.id
		});
		if (typeof params === "object") ringing.copyParams(params);
		// update status
		this.status = this.status === "answered" ? "answered" : "ringing";

		return this._yate.dispatch(ringing);
	}

	/**
	 * progress() is an abstraction over call.progress message.
	 * @method
	 * @param {Object} params - parameters of call.progress message (optional)
	 * @returns {Promise} - resolve(false) if channel is not ready or has not been initialized, resolve(YateMessage) with "call.progress"
	 * @async
	 * @see http://docs.yate.ro/wiki/Call.progress
	 */
	progress(params) {
		if (!this.ready) return Promise.resolve(false);

		let ringing = new YateMessage("chan.masquerade", {
			message: "call.progress",
			id: this.peerid,
			targetid: this.id
		});
		if (typeof params === "object") ringing.copyParams(params);
		// update status
		this.status = this.status === "answered" ? "answered" : "ringing";

		return this._yate.dispatch(ringing);
	}

	/**
	 * answered() is an abstraction over call.answered message.
	 * @method
	 * @param {Object} params - parameters of call.answered message (optional)
	 * @returns {Promise} - resolve(false) if channel is not ready or has not been initialized, resolve(YateMessage) with "call.answered"
	 * @async
	 * @see http://docs.yate.ro/wiki/Call.answered
	 */
	answered(params) {
		if (!this.ready) return Promise.resolve(false);

		let answered = new YateMessage("chan.masquerade", {
			message: "call.answered",
			id: this.peerid,
			targetid: this.id
		});
		if (typeof params === "object") answered.copyParams(params);
		// update status
		this.status = "answered";

		return this._yate.dispatch(answered);
	}

	/**
	 * hangup() is an abstraction over call.drop message.
	 * @method
	 * @param {string} reason - reason parameter of call.drop message (optional)
	 * @returns {Promise} - resolve(YateMessage) with "call.drop" message
	 * @async
	 * @see http://docs.yate.ro/wiki/Call.drop
	 */
	hangup(reason) {
		this.status = "dropped";
		return this._yate.dispatch(new YateMessage("call.drop", {reason: reason, id: this.id}));
	}

	/**
	 * watch() - to set the "watch" handler for the channel: filterName = "id", filterValue = channel.id.
	 * Calling this method multiple times will overwrite the previous event handler. All event subscriptions will be automatically deleted after the call/channel hangup.
	 * @method
	 * @param {function} handler - (required)
	 * @param {string} name - (required)
	 * @returns {Promise}
	 * @async
	 * @see Yate#watch
	 */
	watch(handler, name) {
		if (typeof handler !== "function" || typeof name !== "string") return Promise.reject(new Error("Arguments error. Handler and message name required."));
		return this._yate.watch(handler, name, "id", this.id);
	}

	/**
	 * install() - to set the "install" handler for the channel.
	 * @method
	 * @param {function} handler - (required)
	 * @param {string} name - (required)
	 * @param {number} priority - default value is 80 (optional)
	 * @returns {Promise}
	 * @async
	 * @see Yate#install
	 */
	install(handler, name, priority = 80) {
		if (typeof handler !== "function" || typeof name !== "string") return Promise.reject(new Error("Arguments error. Handler and message name required."));
		return this._yate.install(handler, name, priority, "id", this.id);
	}
}

/**
 * YateMessage is object Yate can interact with.
 * YateMessage can be of two types:<ul>
 * <li>"incoming" - message generated by Engine to Application and can be handled using a callback in the Yate.install or Yate.watch methods</li>
 * <li>"outgoing" - new Message generated by Application and sent to Engine using the Yate.dispatch or Yate.enqueue methods</li>
 * </ul>
 * @class
 * @param {string} name - message name (required)
 * @param {boolean} broadcast (not used)
 * @param {Object} params - message parameters (optional)
 * @example
 * const {Yate, YateMessage} = require("next-yate");
 * let yate = new Yate();
 * yate.init();
 * let m = new YateMessage("call.drop", { id: "sip/123", reason: "timeout" });
 * yate.enqueue(m);
 * @see Yate
 */
class YateMessage {
	constructor(name, broadcast, params) {
		if (typeof name !== "string" || name.length < 1) throw new Error("Message name required.");
		if (typeof broadcast === "boolean") this._broadcast = broadcast;
		if (typeof broadcast === "object" && broadcast) params = broadcast;
		this._name = name;
		this._time = Math.floor(Date.now() / 1000); //sec
		this._id = `${this._time}.${process.hrtime()[1]}`;
		this._type = "outgoing";
		this._handled = false;
		this._yate; // link to Yate
		this.copyParams(params, "", false);
	}

	get name() { return this._name }
	set name(value) { this._name = typeof value === "string" ? value : this._name }
	get time() { return this._time }
	set time(value) { this._time = typeof value === "string" ? value : this._time }
	get handled() { return this._handled }
	set handled(value) { this._handled = typeof value === "boolean" ? value : this._handled }

	/**
	 * @method
	 * @param {string} name - name of the parameter to retrieve (requred)
	 * @param {any} defValue - value to return if parameter is missing (optional)
	 * @param {boolean} autoNumber - automatically convert parameters to boolean or number type, default true (optional)
	 * @returns {any} - value of parameter
	 */
	getParam(name, defValue, autoNumber) {
		if (name === "name") return this._name; // workaround
		if (name === "broadcast") return this._broadcast; // workaround
		if (this[name] === "undefined") return defValue;
		return autoNumber ? this[name] + "" : this[name];
	}
	/**
	 * @method
	 * @param {string} name - name of the parameter to set (required)
	 * @param {any} value - new value to set in parameter, undefined to delete the parameter
	 * @returns {boolean} - true on success, false if message was not in a state where parameters can be changed
	 */
	setParam(name, value) {
		if (("" + name).charAt(0) === "_") return false;
		this[name] = value;
		return true;
	}
	/**
	 * @method
	 * @param {Object} obj - object from which to copy properties (required)
	 * @param {string} prefix - parameters begins with prefix (optional)
	 * @param {string} skip - will be ignored (optional)
	 */
	copyParams(obj, prefix, skip) {
		/*
		 * obj - object from which to copy properties (except objects, null and undefined)
		 * prefix - optional parameter to specify that only properties that a key with the given index should be copied. If the prefix represents an object, the properties of that object will be copied.
		 * skip - optional parameter (assumed, by default, to be true) to specifies if the prefix should be copied or eliminated from the key being copied.
		 */
		if (!obj) return;
		if (typeof obj !== "object") return;
		_deepCopy(this, obj, prefix, skip);
	}
	/**
	 * @method
	 * @param {string} value - new returned value to set in the message, if undefined method returns "Returned value of the message" (optional)
	 * @returns {string} - returned value of the message
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
	toString() {
		let str = `YateMessage {\n  name: ${this._name},\n  id: ${this._id},\n  time: ${this._time},\n  type: ${this._type},\n  handled: ${this._handled},\n`;
		for (let key in this) {
			if (key.startsWith("_")) continue;
			if (typeof this[key] === "function") {
				str += key + ": [Function],\n";
				continue;
			}
			if (typeof this[key] == "object"){
				str += key + ": [Object],\n";
				continue;
			}
			str += "  " + key + ": " + this[key] + ",\n";
		}
		str += `  retValue: ${this._retvalue}\n}`;
		return str;
	}
}
Object.defineProperties(YateMessage.prototype, {
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
 * Yate object provides connection to Yate's external module.
 * @class
 * @param {Object} options - (optional)
 * @param {string} options.host - address of listerning Yate's extmodule for ex. "127.0.0.1", default "undefined", stdin/stdout connected
 * @param {number} options.port - port default 5040
 * @param {string} options.path - socket path, default "undefined"
 * @param {string} options.trackname - track name of connected script, default "next-yate"
 * @param {boolean} options.reconnect - reconnect on collisions, default true
 * @param {number} options.reconnnect_timeout - reconnect tries interval in milliseconds, default 10000
 * @param {number} options.dispatch_timeout - auto drop the response waiting in Yate.dispatch method after the timeout in milliseconds if Engine not respond, default 10000
 * @param {number} options.acknowledge_timeout - auto reply to incoming message as is if the callback function did not responded in the timeout, so as not to overload the Engine queue and not cause the engine to crash. default 10000
 * @param {number} options.bufsize - sets the maximum size of transferred data in extmodule, oversize will be truncated to the specified value, default 8192.
 * @param {boolean} options.channel - to run the Application in channel mode ^NNN=extmodule/nodata/node.sh example.js
 * @example
 * const {Yate} = require("next-yate");
 * let yate = new Yate({host: "127.0.0.1", trackname: "myscript"});
 * yate.init();
 * yate.output("Hello World!");
 * @see Yate#init
 * @see Yate#toChannel
 * @see https://docs.yate.ro/wiki/External_module_command_flow
 */
class Yate extends EventEmitter {
	constructor(options = {}) {
		super();
		this._socket = null;
		this._connected = false;
		this._debug = "debug" in options ? options.debug : false;
		this._host = options.host; // "127.0.0.1"
		this._port = (typeof options.port == "number") ? options.port : _PORT;
		this._path = options.path; // "socket path"
		this._reconnect = "reconnect" in options ? options.reconnect : true;
		this._reconnnect_timeout = (typeof options.reconnnect_timeout == "number") ? options.reconnnect_timeout : _RECONNECT_TIMEOUT;
		this._dispatch_timeout = (typeof options.dispatch_timeout == "number") ? options.dispatch_timeout : _DISPATCH_TIMEOUT;
		this._acknowledge_timeout = (typeof options.acknowledge_timeout == "number") ? options.acknowledge_timeout : _ACKNOWLEDGE_TIMEOUT;
		this._bufsize = (typeof options.bufsize == "number") ? options.bufsize : _BUFFER_SIZE;
		this._trackname = (typeof options.trackname == "string") ? options.trackname : _TRACKNAME;
		this._channel = "channel" in options ? options.channel : false;
		this.setMaxListeners((typeof options.queue == "number") ? options.queue : _OFFLINE_QUEUE);
		this._call_timeout = (typeof options.call_timeout == "number") ? options.call_timeout : _CALL_TIMEOUT;
		this._first_run = true;

		/*
		 * Restore on reconnect:
		 * setlocals, installs, watches
		 */
		// {name, value}
		this._setlocals = [];

		// {name, priority, handler, filterName, filterValue}
		this._installs = [];
		// {name, handler, filterName, filterValue}
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
		} else {
			// do not reconnect on exit
			process.on("SIGINT", () => {
				if (this._socket) this._socket.end();
				this._reconnect = false;
				this.removeAllListeners();
				setTimeout(process.exit, 100);
			});
		}

		// set options
		this.setlocal("trackparam", this._trackname);
		if (this._bufsize !== _BUFFER_SIZE) this.setlocal("bufsize", this._bufsize);
		if (this._reconnect) this.setlocal("restart", this._reconnect);
		if (this._acknowledge_timeout !== _ACKNOWLEDGE_TIMEOUT) this.setlocal("timeout", this._acknowledge_timeout);
	}

	get trackname() { return this._trackname }
	set trackname(name) { if (typeof name === "string") this.setlocal(() => {this._trackname = name}, "trackparam", name) }
	get reconnect() { return this._reconnect }
	set reconnect(value) { if (typeof value === "boolean") this.setlocal(() => {this._reconnect = value}, "restart", value) }
	get debug() { return this._debug }
	set debug(value) { if (typeof value === "boolean") this._debug = value }
	get connected() { return this._connected }
	set connected(value) {} // readonly
	get bufsize() { return this._bufsize }
	set bufsize(value) {
		if (typeof value === "number" && /^\d{3,5}$/.test("" + value) ) {
			this.setlocal("bufsize", value);
			this._bufsize = value;
		}
	}
	get dispatch_timeout() { return this._dispatch_timeout }
	set dispatch_timeout(value) { if (typeof value === "number" && /^\d{3,}$/.test("" + value) ) this._dispatch_timeout = value }
	get acknowledge_timeout() { return this._acknowledge_timeout }
	set acknowledge_timeout(value) {
		if (typeof value === "number" && /^\d{3,}$/.test("" + value) ) {
			this.setlocal("timeout", value);
			this._acknowledge_timeout = value;
		}
	}
	get channel() { return this._channel }
	set channel(value) {} // readonly
	get socket() { return this._socket }
	set socket(value) {} // readonly
	get host() { return this._host }
	set host(value) {} // readonly
	get port() { return this._port }
	set port(value) {} // readonly
	get path() { return this._path }
	set path(value) {} // readonly

	/**
	 * handlers() returns array of message handlers [{name, priority, handler, filterName, filterValue}]
	 * @method
	 * @param {string|RegExp} filter
	 * @returns {Array} - Array of message handlers
	 */
	handlers(filter) {
		let ans = [];
		if (typeof filter === "string") {
			this._installs.forEach(item => { if (item.name === filter) { item.trackName = this._trackname; ans.push(item) } });
			this._watches.forEach(item => { if (item.name === filter) { item.trackName = this._trackname; ans.push(item) } });
		} else if (util.types.isRegExp(filter)) {
			this._installs.forEach(item => { if (filter.test(item.name)) { item.trackName = this._trackname; ans.push(item) } });
			this._watches.forEach(item => { if (filter.test(item.name)) { item.trackName = this._trackname; ans.push(item) } });
		} else {
			this._installs.forEach(item => { item.trackName = this._trackname; ans.push(item) });
			this._watches.forEach(item => { item.trackName = this._trackname; ans.push(item) });
		}
		return ans;
	}

	/**
	 * Init the Yate instance.
	 * Connects it to Extmodule, makes readable and writable inbound and outbound streams. 
	 * @method
	 * @param {function} callback - callback will executed after successful connect
	 * @returns {Promise} - resolve(true) if done or false if failed.
	 * @example
	 * let yate = new Yate();
	 * yate.init(() => { console.log("Connnected") });
	 * @see Yate#toChannel
	 */
	init(callback) {
		if (this._connected) return Promise.resolve(false);
		if (this._channel) return this.toChannel();
	
		// local
		if (!this._host) {
			if (this._connected) return Promise.resolve(false);
			this._connected = true;
			let rl = createInterface(this.in);
			rl.on("line", line => { this._read(line) });
			if (typeof callback === "function") callback(); // <-- callback
			return Promise.resolve(true);
		}
		
		// network
		if (this._timer) clearTimeout(this._timer);
		if (this._socket) this._socket.removeAllListeners();
		this._socket = new Socket();

		this._socket.once("end", () => {
			this._connected = false;
			if (this._timer) clearTimeout(this._timer); // (*)
			this.emit("_disconnect", "Lost connection");
			if (this._reconnect) {
				this._timer = setTimeout(() => {
					if (this._first_run) {
						this.init(callback).then(() => this._first_run = false);
					} else {
						this.init().then(() => this._restore());
					}
				}, this._reconnnect_timeout);
			}
			if (this._debug) this.emit("_debug", "<Socket> end");
		});

		this._socket.once("error", error => {
			this._connected = false;
			if (this._timer) clearTimeout(this._timer); // (*)
			if (this._debug) this.emit("_debug", "<Socket> error");
			if (this._reconnect) {
				this._timer = setTimeout(() => {
					if (this._first_run) {
						this.init(callback).then(() => this._first_run = false);
					} else {
						this.init().then(() => this._restore());
					}
				}, this._reconnnect_timeout);
			} else {
				this.emit("_error", error);
			}
		});

		return new Promise(resolve => {
			// NodeJS versions before v10.x do not sends "ready" event
			this._socket.on(process.version.search(/^v[0-9]\./) == -1 ? "ready" : "connect", () => {
				// workaround for socket case: "end" just after "connect"
				this._timer = setTimeout(() => {
					this.in = this.out = this._socket;
					this._connected = true;
					let rl = createInterface(this.in);
					rl.on("line", line => { this._read(line) });
					this._connect("global", this._trackname, "data");
					this.emit("_connect");
					resolve(true);
				}, 500); //
				if (typeof callback === "function") callback(); // <-- callback
				this._first_run = false;
				if (this._debug) this.emit("_debug", "<Socket> ready");
			});

			this._socket.connect({
				path: this._path,
				port: this._port,
				host: this._host,
				timeout: this.timeout
			});
		});
	}

	_restore() {
		//if (!this._connected) return;
		// re-setlocal, re-install & re-watch
		this._setlocals.forEach(item => {
			this._setlocal(item.name, item.value);
		});
		this._installs.forEach(item => {
			this._install(item.name, item.priority);
		});
		this._watches.forEach(item => {
			this._watch(item.name);
		});
	}

	/**
	 * Alternative initialization of Yate in channel mode with the special Channel object. 
	 * New instance of Yate --> Yate.toChannel --> Channel.init --> callback
	 * @method
	 * @returns {YateChannel}
	 * @example
	 * regexroute.conf:
	 * ^NNN=extmodule/nodata/node.sh example.js
	 * 
	 * example.js:
	 * const {Yate} = require("next-yate");
	 * const yate = new Yate();
	 * const Channel = yate.toChannel();
	 * Channel.init(main, {autoanswer: true});
	 * 
	 * function main(message) {
	 *     if (message.called=="32843")
	 *         Channel.callJust("wave/play/./share/sounds/welcome.au");
	 * }
	 * @see Yate#init
	 * @see YateChannel
	 */
	toChannel() {
		if (typeof this._channel === "object") return this._channel;
		if (this._host || this._connected) return;
		this._reconnect = false;
		this._connected = true;
		const _yate = this;

		// like YateChannel
		const chan = new EventEmitter();
		chan.peerid = _yate._trackname + "/" + process.hrtime()[1];
		chan.id = null;
		chan.status = "incoming";

		_yate._setlocal("id", chan.peerid);

		chan.init = (callback, params) => {
			if (chan.id) {
				let message = {name: "call.execute", id: chan.id, peerid: chan.peerid, handled: true};
				if (typeof callback === "object") message.copyParams(callback);
				if (typeof params === "object") message.copyParams(params);
				if (typeof callback === "function") callback(message);
				return Promise.resolve(message);
			}
			
			return new Promise(resolve => {		
				// append call.execute handler
				let handler_idx = _yate._installs.length;
				_yate._installs[handler_idx] = {
					handler: message => {
						// remove handler
						delete _yate._installs[handler_idx];
						// update peerid
						chan.id = message.id;
						chan.status = message.answered || message.autoanswer ? "answered" : message.status;
						chan.ready = true;
						// 
						message.targetid = chan.peerid;
						message.earlymedia = true;
						message.handled = true;
						if (typeof callback === "object") message.copyParams(callback);
						if (typeof params === "object") message.copyParams(params);
						_yate.acknowledge(message);
						//
						_yate.watch(() => {}, "chan.notify", "id", chan.id); // prevents watch/unwatch till channel lifetime
						if (typeof callback === "function") callback(message);
						resolve(message);
						return;
					},
					name: "call.execute",
					priority: 0
				};
			});
		};

		chan.callTo = (dst, params = {}) => {
			if (!chan.ready || typeof dst !== "string") return Promise.resolve(false);
		
			let notify = _yate._trackname + "-notify/" + process.hrtime()[1]; // <-- special targetid for notify handler
			let eof = true;
			let timeout;
			if (typeof params.timeout === "number") timeout = params.timeout;
			let attach;

			if (dst.startsWith("wave/record")) {
				// wave/record
				attach  = new YateMessage("chan.attach", {
					id: chan.peerid,
					source: "wave/play/-",
					consumer: dst,
					maxlen: 180000, //default 10 sec
					notify: notify
				});
			} else if (dst.startsWith("tone/dtmf")) {
				// tone/dtmf
				attach  = new YateMessage("chan.masquerade", {
					message: "chan.attach",
					id: chan.id,
					override: dst,
					notify: notify
				});
				if (!timeout && dst.startsWith("tone/dtmfstr/")) {
					timeout = dst.slice(14).length * 250;
				} else {
					timeout = 250;
				}
				eof = false;
			} else {
				// wave/play, tone/
				attach  = new YateMessage("chan.attach", {
					id: chan.peerid,
					source: dst,
					consumer: "wave/record/-",
					notify: notify
				});
			}

			if (typeof params === "object") attach.copyParams(params);

			return new Promise((resolve, reject) => {
				// reset
				chan.once("reset", reject);
				// tone
				if (!eof) {
					_yate.dispatch(attach)
						.then(message => { setTimeout(() => {message.reason = "eof"; resolve(message)}, timeout ? timeout : 250) });
					return;
				}

				// watcher
				let handler;
				_yate.watch(handler = (message) => {
					clearTimeout(timer);
					_yate.unwatch(handler, "chan.notify", "targetid", notify);
					resolve(message);
					chan.removeListener("reset", reject);
				}, "chan.notify", "targetid", notify);

				// timeout
				let timer = setTimeout(() => {
					_yate.unwatch(handler, "chan.notify", "targetid", notify);
					attach.reason = "eof";
					resolve(attach);
					chan.removeListener("reset", reject);
				}, timeout ? timeout : _yate._call_timeout);

				_yate.enqueue(attach);
			});
		};

		chan.callJust = (dst, params) => {
			if (!chan.ready  || typeof dst !== "string") return Promise.resolve(false);

			let callto = new YateMessage("chan.masquerade", {
				message: "call.execute",
				id: chan.id,
				callto: dst
			});

			if (typeof params === "object") callto.copyParams(params);
		
			return _yate.dispatch(callto)
				.then(() => { setTimeout(() => {process.exit(0)}, 3) });
		};
		
		chan.ringing = (params) => {
			if (!chan.ready) return Promise.resolve(false);

			let ringing = new YateMessage("call.ringing", {
				id: chan.peerid,
				targetid: chan.id
			});
			if (typeof params === "object") ringing.copyParams(params);
			// update status
			chan.status = chan.status === "answered" ? "answered" : "ringing";

			return _yate.dispatch(ringing);
		};

		chan.progress = (params) => {
			if (!chan.ready) return Promise.resolve(false);
	
			let ringing = new YateMessage("call.progress", {
				id: chan.peerid,
				targetid: chan.id
			});
			if (typeof params === "object") ringing.copyParams(params);
			// update status
			chan.status = chan.status === "answered" ? "answered" : "ringing";
	
			return _yate.dispatch(ringing);
		}

		chan.answered = (params) => {
			if (!chan.ready) return Promise.resolve(false);

			let answered = new YateMessage("call.answered", {
				id: chan.peerid,
				targetid: chan.id
			});
			if (typeof params === "object") answered.copyParams(params);
			// update status
			chan.status = "answered";

			return _yate.dispatch(answered);
		};

		chan.hangup = (reason) => {
			chan.status = "dropped";
			return _yate.dispatch(new YateMessage("call.drop", {reason: reason, id: chan.id}))
				.then(() => { setTimeout(() => {process.exit(0)}, 3) });
		};

		chan.reset = (message) => { chan.emit("reset", message) };

		chan.watch = (handler, name) => {
			if (typeof handler !== "function" || typeof name !== "string") return Promise.reject(new Error("Arguments error. Handler and message name required."));
			return _yate.watch(handler, name, "id", chan.id);
		};
	
		chan.install = (handler, name, priority = 80) => {
			if (typeof handler !== "function" || typeof name !== "string") return Promise.reject(new Error("Arguments error. Handler and message name required."));
			return _yate.install(handler, name, priority, "id", chan.id);
		};

		this._channel = chan;

		let rl = createInterface(this.in);
		rl.on("line", line => { this._read(line) });
		this.emit("_connect");

		return chan;
	}

	/**
	 * Returns Console connected to Yate's output
	 * @method
	 * @returns {Console}
	 * @example
	 * yate.getConsole().log("Find this message in yate's output");
	 */
	getConsole() { return this._console }

	/**
	 * Returns set of connection's specific parameners
	 * @method
	 * @async
	 * @returns {Promise} - resolve(Object) where Object is set of connection's specific parameners
	 * @example
	 * {
	 *   version: '6.1.1',
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
	 * };
	 */
	getEnvironment() {
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
			return ans;
		});
	}

	/**
	 * Acknowledges the message.
	 * Not needed in common cases because of all incoming messages acknowledges automatically
	 * @method
	 * @param {YateMessage} message 
	 * @returns {Promise} - resolve(YateMessage) or reject(Error)
	 * @async
	 */
	acknowledge(msg) {
		if ("_id" in msg && "_name" in msg && "_time" in msg && "_type" in msg && msg._type === "incoming") {
			this._acknowledge(msg);
			return Promise.resolve(msg);
		} else {
			return Promise.reject(new Error("Invalid message: " + msg));
		}
	}

	/**
	 * Sets the handler to a specific message.
	 * @method
	 * @param {function} handler - message handler (required)
	 * @param {string} name - message name (required)
	 * @param {number} prio - priority of the handler on Yate's side, as low value as high proirity (optional, default value 100)
	 * @param {string} filter - filter is name of message parameter (optional, for example "called")
	 * @param {string} fvalue - filter is value of message parameter (optional, for example "^9999.*")
	 * @returns {Promise} - resolve(true) on successfully installed handler, resolve(false) on fail, reject(Error) on error
	 * @async
	 * @example
	 * const {Yate, YateMessage} = require("next-yate");
	 *
	 * function onRoute(message) {
	 *     message.retValue("tone/ring"); // send the incoming call to tone/ring module
	 * }
	 *
	 * let yate = new Yate();
	 * yate.init();
	 * yate.install(onRoute, "call.route", 90, "called", "^9999.*");
	 * @see YateMessage
	 * @see https://docs.yate.ro/wiki/Standard_Messages
	 */
	install(handler, name, prio, filter, fvalue) {
		if (typeof handler !== "function" || typeof name !== "string")
			return Promise.reject(new Error("Install arguments error. Handler and Message name are required."));
		
		let priority = 100;
		let filterName;
		let filterValue;
		if (typeof prio !== "number") {
			priority = 100;
			filterName = typeof prio === "string" ? prio : undefined;
			filterValue = typeof filter === "string" ? filter : undefined;
		} else {
			priority = prio;
			filterName = typeof filter === "string" ? filter : undefined;
			filterValue = typeof fvalue === "string" ? fvalue : undefined;
		}

		// add / replace installed
		let installed = false;
		let replace = -1;
		let add = this._installs.length;
		let reinstall = false;
		for (let i = 0; i < this._installs.length; i++) {
			if (!this._installs[i]) add = i;
			if (this._installs[i] && this._installs[i].name === name) {
				installed = true;
				if (this._installs[i].priority !== priority) reinstall = true;
				if (this._installs[i].filterName === filterName && this._installs[i].filterValue === filterValue) replace = i;
			}
		}
		let idx = replace < 0 ? add : replace;
		this._installs[idx] = {
			name: name,
			handler: handler,
			priority: priority,
			filterName: filterName,
			filterValue: filterValue
		};

		if (!installed) {
			// install
			this._install(name, priority);
			return new Promise(resolve => {
				this.once("_install," + name, success => {
					if (!success) delete this._installs[idx];
					resolve(success);
				});
			});
		} else if(reinstall) {
			// reinstall with new priority
			this._uninstall(name);
			this._install(name, priority);
			return new Promise(resolve => {
				this.once("_install," + name, success => {
					if (!success) delete this._installs[idx];
					resolve(success);
				});
			});
		} else {
			return Promise.resolve(true);
		}
	}

	/**
	 * Removes the handler from a specific message
	 * @method
	 * @param {string} name - message name (required)
	 * @returns {Promise} - resolve(true) if message handler removed from Yate's side, resolve(false) if no, reject(Error) on error.
	 * @async
	 * @example
	 * yate.uninstall("call.route");
	 * @see Yate#install
	 */
	uninstall(...args) {
		// parse arguments
		let handler, name, priority, filterName, filterValue;
		
		if (args.length > 4) {
			handler = typeof args[0] === "function" ? args[0] : undefined;
			name = typeof args[1] === "string" ? args[1] : undefined;
			priority = typeof args[2] === "number" ? args[2] : undefined;
			filterName = typeof args[3] === "string" ? args[3] : undefined;
			filterValue = typeof args[4] === "string" ? args[4] : undefined;
		} else if (args.length > 3) {
			handler = typeof args[0] === "function" ? args[0] : undefined;
			name = typeof args[1] === "string" ? args[1] : undefined;
			filterName = typeof args[2] === "string" ? args[2] : undefined;
			filterValue = typeof args[3] === "string" ? args[3] : undefined;
		} else if(args.length > 2) {
			name = typeof args[0] === "string" ? args[0] : undefined;
			filterName = typeof args[1] === "string" ? args[1] : undefined;
			filterValue = typeof args[2] === "string" ? args[2] : undefined;
		} else if(args.length > 1) {
			handler = typeof args[0] === "function" ? args[0] : undefined;
			name = typeof args[1] === "string" ? args[1] : undefined;
		} else if(args.length > 0){
			name = typeof args[0] === "string" ? args[0] : undefined;
		}

		if (!name) return Promise.reject(Error("Uninstall arguments error. Message name required."));

		// remove handlers
		for (let i = 0; i < this._installs.length; i++) {
			if (this._installs[i] && this._installs[i].name === name) {
				if (filterName && this._installs[i].filterName !== filterName) continue;
				if (filterValue && this._installs[i].filterValue !== filterValue) continue;
				if (priority && this._installs[i].priority !== priority) continue;
				if (handler && this._installs[i].handler !== handler) continue;
				if (!handler && !filterName && !filterValue && this._installs[i].filterName && this._installs[i].filterValue) continue;
				delete this._installs[i];
			}
		}

		// uninstall if have no handlers
		let installed = false;
		for (let i = 0; i < this._installs.length; i++) {
			if (this._installs[i] && this._installs[i].name === name) {
				installed = true;
				break;
			}
		}

		if (!installed) {
			this._uninstall(name);
			return new Promise(resolve => {
				this.on("_uninstall," + name, success => resolve(success));
			});
		} else {
			return Promise.resolve(false);
		}
	}

	/**
	 * Sets the handler to a specific yate message.
	 * In contrast to the method of Yate.install it does not require an answer to message. You will get already handled messages.
	 * @method
	 * @param {function} handler - function to be message handler (required)
	 * @param {string} name - message name (required)
	 * @returns {Promise} - resolve(true) on successfully installed handler, resolve(false) on fail, reject(Error) on error.
	 * @async
	 * @example
	 * const {Yate, YateMessage} = require("next-yate");
	 *
	 * function onTimer(message) {
	 *     concole.log(message.time);
	 * }
	 *
	 * let yate = new Yate();
	 * yate.init();
	 * yate.watch(onTimer, "engine.timer");
	 * @see https://docs.yate.ro/wiki/Standard_Messages
	 * @see Yate#install
	 */
	watch(handler, name, filterName, filterValue) {
		if (typeof handler !== "function" || typeof name !== "string")
			return Promise.reject(new Error("Watch arguments error. Handler and message name are required."));

		// add / replace watched
		let watched = false;
		let replace = -1;
		let add = this._watches.length;
		for (let i = 0; i < this._watches.length; i++) {
			if (!this._watches[i]) add = i;
			if (this._watches[i] && this._watches[i].name === name) {
				watched = true;
				if (this._watches[i].filterName === filterName && this._watches[i].filterValue === filterValue) replace = i;
			}
		}
		
		let idx = replace < 0 ? add : replace;
		this._watches[idx] = {
			name: name,
			handler: handler,
			filterName: typeof filterName === "string" ? filterName : undefined,
			filterValue: typeof filterValue === "string" ? filterValue : undefined
		};
		if (!watched) {
			// watch
			this._watch(name);
			return new Promise(resolve => {
				this.once("_watch," + name, success => {
					if (!success) delete this._watches[idx];
					resolve(success);
				});
			});
		} else {
			return Promise.resolve(true);
		}
	}

	/**
	 * Removes the watch handler from a specific yate message.
	 * @method
	 * @param {string} name - message name (required)
	 * @returns {Promise} - resolve(true) if message handler removed from Yate's side, resolve(false) if no, reject(Error) on error.
	 * @async
	 * @example
	 * yate.unwatch("engine.timer");
	 * @see Yate#watch
	 */
	unwatch(...args) {
		// parse arguments
		let handler, name, filterName, filterValue;
		
		if (args.length > 3) {
			handler = typeof args[0] === "function" ? args[0] : undefined;
			name = typeof args[1] === "string" ? args[1] : undefined;
			filterName = typeof args[2] === "string" ? args[2] : undefined;
			filterValue = typeof args[3] === "string" ? args[3] : undefined;
		} else if(args.length > 2) {
			name = typeof args[0] === "string" ? args[0] : undefined;
			filterName = typeof args[1] === "string" ? args[1] : undefined;
			filterValue = typeof args[2] === "string" ? args[2] : undefined;
		} else if(args.length > 1) {
			handler = typeof args[0] === "function" ? args[0] : undefined;
			name = typeof args[1] === "string" ? args[1] : undefined;
		} else if(args.length > 0){
			name = typeof args[0] === "string" ? args[0] : undefined;
		}

		if (!name) throw Error("Unwatch function arguments error. Message name is require.");

		// remove handlers
		for (let i = 0; i < this._watches.length; i++) {
			if (this._watches[i] && this._watches[i].name === name) {
				if (filterName && this._watches[i].filterName !== filterName) continue;
				if (filterValue && this._watches[i].filterValue !== filterValue) continue;
				if (handler && this._watches[i].handler !== handler) continue;
				if (!handler && !filterName && !filterValue && this._watches[i].filterName && this._watches[i].filterValue) continue;
				delete this._watches[i];
			}
		}

		// unwatch if have no handlers
		let watched = false;
		for (let i = 0; i < this._watches.length; i++) {
			if (this._watches[i] && this._watches[i].name === name) {
				watched = true;
				break;
			}
		}

		if (!watched) {
			this._unwatch(name);
			return new Promise(resolve => {
				this.on("_uninstall," + name, success => resolve(success));
			});
		} else {
			return Promise.resolve(false);
		}
	}

	/**
	 * Set/change/read connection parameters.
	 * @method
	 * @param {string} name - parameter name (required)
	 * @param {string} value - parameter value (optional, if undefined the method returns the parameter value)
	 * @returns {Promise} - resolve(value or success)
	 * @async
	 * @example
	 * const {Yate, YateMessage} = require("next-yate");
	 * let yate = new Yate();
	 * yate.init();
	 * let ver = await yate.setlocal("engine.version");
	 * console.log(ver);
	 * @see https://docs.yate.ro/wiki/External_module_command_flow
	 */
	setlocal(name, value) {
		if (typeof name === "string" && (
			typeof value === "string" ||
			typeof value === "boolean" ||
			typeof value === "number" ||
			value === undefined) ) {

			return new Promise( (resolve) => {
				this._setlocal(name, value);
				let event = "_setlocal," + name;
				//let handler;

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

				// skip setlocal query by timeout
				let timeout = setTimeout(() => {
					//this.removeListener(event, handler);
					resolve(false);
				}, this._dispatch_timeout);

			});
		} else {
			return Promise.reject(new Error("Setlocal arguments error. At least name required."));
		}
	}

	/**
	 * Enqueues the Message in the Yate engine
	 * @method
	 * @param {YateMessage} message (required)
	 * @returns {Promise} - resolve(YateMessage) with unhandled message or reject(Error) on error
	 * @async
	 * @example
	 * const {Yate, YateMessage} = require("next-yate");
	 * let yate = new Yate();
	 * yate.init();
	 * let m = new YateMessage("call.drop", false, { id: "sip/123" });
	 * yate.equeue(m);
	 * @see Yate#dispatch
	 */
	enqueue(msg) {
		if ("_id" in msg && "_name" in msg && "_time" in msg) {
			this._dispatch(msg);
			return Promise.resolve(msg);
		} else {
			return Promise.reject(new Error("Equeue arguments error. YateMessage required."));
		}
	}

	/**
	 * Dispatches the Message in the Yate engine.
	 * @method
	 * @param {YateMessage} message (required)
	 * @returns {Promise} - reolve(YateMessage) where YateMessage is handled message, reject(Error) on error
	 * @async
	 * @example
	 * const {Yate, YateMessage} = require("next-yate");
	 * let yate = new Yate();
	 * yate.init();
	 * let m = new YateMessage("call.route", false, { id: "test/1", caller: "123", called: "321" });
	 * yate.dispatch(m)
	 *     .then(res => {console.log("Successfully dispatched\n", res.retValue())},
	 *           err => {console.log("Dispatch error\n", err)} );
	 * @see Yate#enqueue
	 */
	dispatch(msg) {
		if ("_id" in msg && "_name" in msg && "_time" in msg ) {
			return new Promise(resolve => {
				this._dispatch(msg);
				let event = "_answer," + msg._id;
				let handler;
				
				this.once(event, handler = (m) => {
					clearTimeout(timeout);
					resolve(m);
				});
				// kill slow dispatches by timeout
				let timeout = setTimeout(() => {
					this.removeListener(event, handler);
					msg._handled = false;
					resolve(msg);
				}, this._dispatch_timeout);
			});
		} else {
			return Promise.reject(new Error("Dispach arguments error. YateMessage required."));
		}
	}

	/**
	 * Output data to Yate log.
	 * @method
	 * @param {string} line
	 */
	output(...args) {
		args.join(" ").split("\n").forEach(l => this._output(l));
	}

	// External module command flow reader
	_read(line) {
		if (this._debug) this.emit("_debug", "<-- " + line);
		let msg = _parseMessage(line);
		msg._yate = this; // append link to parent Yate
		switch (msg._type) {
			case "answer":
				this.emit("_answer," + msg._id, msg); // _answer,id = dispatch result
				break;
			case "incoming":
				// installed
				// eslint-disable-next-line no-case-declarations
				let promises = [];
				this._installs.forEach(item => {
					if (item.name === msg.name && typeof item.handler === "function") {
						if (typeof item.filterName === "string" && typeof item.filterValue === "string") {
							if (item.filterName in msg && RegExp(item.filterValue).test(msg[item.filterName])) {
								promises.push(item.handler(msg));
							}
						} else {
							promises.push(item.handler(msg));
						}
					}
				});
				if (promises.length > 0) {
					Promise.all(promises)
						.then(res => {
							for (let i = 0; i < res.length; i++) {
								if (typeof res[i] === "boolean" && res[i]) {
									msg._handled = true;
									break;
								}
							}
							this._acknowledge(msg);
						});
				} else {
					this._acknowledge(msg);
				}
				break;
			case "notification":
				// watched
				this._watches.forEach(item => {
					if (item.name === msg.name && typeof item.handler === "function") {
						if (typeof item.filterName === "string" && typeof item.filterValue === "string") {
							if (item.filterName in msg && RegExp(item.filterValue).test(msg[item.filterName])) {
								item.handler(msg);
							}
						} else {
							item.handler(msg);
						}
					}
				});
				break;

			case "install":
				this.emit("_install," + msg._name, msg._success); // _install,event = install result
				break;

			case "uninstall":
				this.emit("_uninstall," + msg._name, msg._success); // _uninstall,event = uninstall result
				break;

			case "watch":
				this.emit("_watch," + msg._name, msg._success); // _watch,event = watch result
				break;

			case "unwatch":
				this.emit("_unwatch," + msg._name, msg._success); // _unwatch,event = _unwatch result
				break;

			case "setlocal":
				this.emit("_setlocal," + msg._name, msg); // _setlocal,event = _setlocal result
				break;

			case "error":
				this.emit("_error", msg._retvalue);
		}
	}

	/*
	 * External module protocol, direction application -> engine
	 */
	_write(line) {
		if (line.length > this.bufsize) line = line.substr(0, this.bufsize); // trim the line to max buffer size
		if (this._connected) {
			if (this._debug) this.emit("_debug", "--> " + line);
			try { this.out.write(line.endsWith("\n") ? line : line + "\n"); }
			catch(error) {
				this._connected = false;
				if (this._timer) clearTimeout(this._timer);
				if (this._debug) this.emit("_debug", "<I/O> error");
				if (this._reconnect) {
					this._timer = setTimeout(() => { this.init().then(() => this._restore()) }, this._reconnnect_timeout);
				} else {
					this.emit("_error", error);
				}
			}
		} else {
			// scheduled line
			this.once("_connect", () => { this._write(line) });
		}
	}

	// %%>connect:<role>[:<id>][:<type>]
	_connect(role, id, type) {
		if (role.match(/^(global|channel|play|record|playrec)$/))
			this._write("%%>connect:" + role + (id ? ":" + _escape(id) : "") + (type ? ":" + _escape(type) : ""));
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
		if (msg._type !== "incoming" || msg._acknowledged) return;
		msg._acknowledged = true;
		this._write("%%<message:" + _escape(msg._id) + ":" + _bool2str(msg._handled) + "::" + _escape(msg._retvalue) + _par2str(msg));
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
 * Dump stream to string.
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
 * External module protocol, direction application <- engine.
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
			params._acknowledged = false;
			break;
		case "%%<message": // %%<message:<id>:<processed>:[<name>]:<retvalue>[:<key>=<value>...]
			params._id = arg[1];
			params._handled = _str2bool(arg[2]);
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
		case "%%<unwatch": // %%<watch:<name>:<success>
			params._name = arg[1];
			params._success = _str2bool(arg[2]);
			params._type = "unwatch";
			break;
		case "%%<setlocal": // %%<setlocal:<name>:<value>:<success>
			params._name = arg[1];
			params._retvalue = _unescape(arg[2]);
			params._success = _str2bool(arg[3]);
			params._type = "setlocal";
			break;
		case "Error in":
		default:
			params._name = "error";
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
	return new YateMessage(params._name, params);
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
		if (typeof obj[key] === "undefined") continue;
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
function _deepCopy(dst, src, prefix = "_", skip = true) {
	for (let key in src) {
		if (key.startsWith(prefix) && skip) continue;
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
	Yate,
	YateMessage,
	YateChannel,
	DumpStream
};

/**
 * eliza.js
 * This file is part of the YATE Project http://YATE.null.ro
 *
 * Yet Another Telephony Engine - a fully featured software PBX and IVR
 * Copyright (C) 2014 Null Team
 *
 * This software is distributed under multiple licenses;
 * see the COPYING file in the main directory for licensing
 * information for this specific distribution.
 *
 * This use of this software may be subject to additional restrictions.
 * See the LEGAL file in the main directory for details.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

/*
 * This script installs an Eliza chat bot for rmanager
 * It will handle all typed text that is not interpreted as command
 * To use it put in extmodule.conf:
 *
 * [scripts]
 * node.sh=eliza.js
 */

// Adapted to Nodejs by Anton <aucyxob@gmail.com>
const { chatWithBot } = require("libchatbot.js"); // #require "libchatbot.js"
const { Engine, Message } = require("next-yate").getEngine(); //load compatible API objects
global.Engine = Engine;   //
global.Message = Message; // share Engine and Message with other modules.

function onCommand(msg) {
	if (msg.partline) // if (msg.partline != "")
		return false;
	if (msg.line == "") return false;
	msg.retValue(chatWithBot(msg.line, msg.cmd_address) + "\r\n");
	return true;
}

Engine.debugName("eliza");
Message.trackName("eliza");
Engine.debugEnabled(true);
Message.install(onCommand, "engine.command", 1000);

/* vi: set ts=8 sw=4 sts=4 noet: */
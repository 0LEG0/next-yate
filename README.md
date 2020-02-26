# Next-Yate

## Next-Yate is Nodejs interface library to the Yate external module (Yet Another Telephony Engine).

## Features

- Simple to use.
- Independence of other Nodejs modules.
- Auto-restore connections and message handlers on network collisions.
- Cache of all requests in offline mode.
- Auto-acknowledge of the incoming messages by acknowledge_timeout. (This can be critical under high load, as it prevents Yate from crashing).

[View Documentation](https://htmlpreview.github.io/?https://github.com/0LEG0/next-yate/blob/master/docs/index.html)

[External module protocol](https://docs.yate.ro/wiki/External_module_command_flow)

## Quick start

### Before starting

(If you still don't know what Yate is https://docs.yate.ro/wiki/Main_Page)

Make sure the Yate's module **extmodule.yate** is successfully loaded (https://docs.yate.ro/wiki/External_Module)

_yate.conf_:

```
[modules]
extmodule.yate=true
```

_extmodule.conf_:

```
; For network connection
[listener sample]
type=tcp
addr=127.0.0.1
port=5040
role=global
;
; Local stdin/stdout connected scripts
[scripts]
myscript.sh=            ; Custom shell wrapper around Nodejs script
node.sh=my_script.js    ; Run my_script.js with example wrapper: examples/node.sh
```

### Install
```
npm install next-yate
```

### Network connected script

example_core_api.js:

```javascript
// Core API
const { Yate, YateMessage } = require("next-yate");
let yate = new Yate({ host: "127.0.0.1" });

yate.init(() => console.log("Connected")); // Initialize connection before use
yate.output("Hello World!");
```

### Local connected script

When launching your script, be sure that Nodejs will find the necessary libraries.

extmodule.conf:

```
[scripts]
node.sh=my_scrypt.js
```

Example of shell wrapper around Nodejs

node.sh:

```
#!/bin/sh

SCRIPTS=/path_to/share/scripts
export NODE_PATH=$SCRIPTS
NODE=`which node`

$NODE $SCRIPTS/$1
```

### Direct script execution mode from callto context

regexroute.conf:
```
^NNN=extmodule/nodata/node.sh example.js
```

example.js
```javascript
const { Yate } = require("next-yate");
const yate = new Yate();
const Channel = yate.toChannel();
Channel.init(main, {autoring: true});

async function main(message) {
    await Channel.callTo("wave/play/./share/sounds/welcome.au");
    await Channel.answered();
    Channel.callJust("conf/333", {"lonely": true});
}
```

### Examples
[/examples](https://github.com/0LEG0/next-yate/tree/master/examples)

### API
[View Documentation](https://htmlpreview.github.io/?https://github.com/0LEG0/next-yate/blob/master/docs/index.html)


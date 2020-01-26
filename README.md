# Next-Yate (Experimental)

## Next-Yate is Nodejs interface library to the Yate external module (Yet Another Telephony Engine).

It contains two APIs to Yate:

1. The first **core API** is, in fact, the rewritten Nodejs version of the official PHP library libyate.php which is represented by following classes:
    - **Yate**
    - **Message**

2. The second **compatible API** is my attempt to ensure API compatibility with the  Yate's JavaScript module (https://docs.yate.ro/wiki/Javascript_module). This API allows you to run scripts written for javascript.yate module in Nodejs enviroment with minimal modifications. To use the compatible API, you need to request following objects from the **getEngine** function:
    - **Engine**
    - **Message**

## Features

- Compatibility with javascript.yate with minimal code modifications, of course. (Please find eliza.js in /examples)
- Independence of other Nodejs modules.
- Auto-restore connections and message handlers on network collisions.
- Cache of all requests in offline mode.
- Auto-acknowledge of the incoming messages by acknowledge_timeout. (This can be critical under high load, as it prevents Yate from crashing).

[API description /doc](https://htmlpreview.github.io/?https://github.com/0LEG0/next-yate/blob/master/doc/index.html)

https://docs.yate.ro/wiki/Javascript_Reference

https://docs.yate.ro/wiki/External_module_command_flow


## Compatibility table

| API                   | javascrip.yate | next-yate | (\*)       |
| :-------------------- | :------------- | :-------- | :--------- |
| Message.install       | yes            | yes       |            |
| Message.uninstall     | yes            | yes       |            |
| Message.watch         | -              | yes       |            |
| Message.unwatch       | -              | yes       |            |
| Message.enqueue       | yes            | yes       | _void_     |
| Message.dispatch      | yes            | yes       | _async_    |
| Message.handlers      | yes            | -         |            |
| Message.installHook   | yes            | -         |            |
| Message.uninstallHook | yes            | -         |            |
| Message.trackName     | yes            | yes       | _async_    |
| Message.broadcast     | yes            | -         |            |
| Message.getParam      | yes            | yes       |            |
| Message.setParam      | yes            | yes       |            |
| Message.copyParams    | yes            | yes       | _not full_ |
| Message.retValue      | yes            | yes       |            |
| Message.msgTime       | yes            | yes       |            |
| Message.getColumn     | yes            | -         |            |
| Message.getRow        | yes            | -         |            |
| Message.getResult     | yes            | -         |            |
| Engine.output         | yes            | yes       |            |
| Engine.debug          | yes            | yes       |            |
| Engine.alarm          | yes            | -         |            |
| Engine.sleep          | yes            | yes       | _async_    |
| Engine.usleep         | yes            | yes       | _async_    |
| Engine.yield          | yes            | -         |            |
| Engine.idle           | yes            | -         |            |
| Engine.restart        | yes            | -         |            |
| Engine.dump_r         | yes            | yes       | _not full_ |
| Engine.print_r        | yes            | yes       | _not full_ |
| Engine.dump_t         | yes            | -         |            |
| Engine.print_t        | yes            | yes       |            |
| Engine.debugName      | yes            | yes       |            |
| Engine.debugLevel     | yes            | yes       |            |
| Engine.debugEnabled   | yes            | yes       |            |
| Engine.debugAt        | yes            | yes       |            |
| Engine.setDebug       | yes            | yes       |            |
| Engine.started        | yes            | yes       |            |
| Engine.runParams      | yes            | -         |            |
| Engine.configFile     | yes            | -         |            |
| Engine.setInterval    | yes            | yes       |            |
| Engine.setTimeout     | yes            | yes       |            |
| Engine.clearInterval  | yes            | yes       |            |
| Engine.clearTimeout   | yes            | yes       |            |
| Engine.loadLibrary    | yes            | -         |            |
| Engine.loadObject     | yes            | -         |            |
| Engine.replaceParams  | yes            | yes       |            |
| Engine.atob           | yes            | yes       |            |
| Engine.btoa           | yes            | yes       |            |
| Engine.atoh           | yes            | -         |            |
| Engine.htoa           | yes            | -         |            |
| Engine.btoh           | yes            | -         |            |
| Engine.htob           | yes            | -         |            |
| Engine.shared         | yes            | -         |            |
| Engine.name           | yes            | -         |            |
| Math.abs              | yes            | yes       |            |
| Math.max              | yes            | yes       |            |
| Math.min              | yes            | yes       |            |
| Math.random           | yes            | yes       | _different_|
| parseInt              | yes            | yes       |            |
| isNan                 | yes            | -         |            |
| RegExp.test           | yes            | yes       |            |
| RegExp.valid          | yes            | -         |            |
| Date                  | yes            | yes       |            |
| XML                   | yes            | -         |            |
| Hasher                | yes            | -         |            |
| JSON.parse            | yes            | yes       |            |
| JSON.stringify        | yes            | yes       |            |
| JSON.loadFile         | yes            | -         |            |
| JSON.saveFile         | yes            | -         |            |
| JSON.replaceParams    | yes            | -         |            |
| DNS                   | yes            | -         |            |
| Shared                | yes            | -         |            |
| File                  | yes            | -         |            |
| ConfigFile            | yes            | -         |            |
| ConfigSection         | yes            | -         |            |
| Channel               | yes            | -         |            |
| String                | yes            | yes       | _different_|


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
/usr/bin/node=local_script.js; You must be sure that Nodejs will find the necessary libraries
local_script.sh=; Proxy startup script with environment settings
```

### Network connected script

example_core_api.js:

```javascript
// Core API
const { Yate, Message } = require("/path_to/libyate.js");
let yate = new Yate({ host: "127.0.0.1" });

yate.init(() => console.log("Connected")); // Initialize connection before use
yate.output("Hello World!");
```
exapmle_compatible_api.js:

```javascript
// Compatible API
const { getEngine } = require("/path_to/libyate.js");
const { Engine, Message } = getEngine({ host: "127.0.0.1" });

Engine.output("Hello World!");
```

### Local connected script

When launching your script, be sure that Nodejs will find the necessary libraries.

extmodule.conf:

```
[scripts]
local_script.sh=
```

Example of shell script

local_script.sh:

```
#!/bin/sh
cd /path_to/share/scripts
export NODE_PATH=/path_to/share/scripts
/usr/bin/node eliza.js
```


[API Description /doc](https://htmlpreview.github.io/?https://github.com/0LEG0/next-yate/blob/master/doc/index.html)

[Examples /examples](https://github.com/0LEG0/next-yate/tree/master/examples)
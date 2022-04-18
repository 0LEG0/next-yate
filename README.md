# Next-Yate

## Next-Yate is Nodejs interface library to the Yate external module (Yet Another Telephony Engine).

## Features

- Simple to use.
- Channel half-stuff abstraction. _(Now creation of IVR or dialplan is as easy as a piece of cake)_.
- Auto-restore connections and message handlers on network collisions.
- Cache of all requests in offline mode.
- Auto-acknowledge of the incoming messages by acknowledge_timeout. _(This can be critical under high load, as it prevents Yate from crashing)_.
- Independence of other Nodejs modules.

(* Compatibility with javascript.yate has been moved to [Next-Yate-Compat](https://github.com/0LEG0/next-yate-compat))

[View API](API.md)

[External module protocol](https://docs.yate.ro/wiki/External_module_command_flow)

## Overiew
- Yate class provides connection to Yate's external module.
- YateMessage class is object Yate's external module can interact with.
- YateChannel class is an abstraction over incoming call leg messages flow.

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

### Direct script execution (Channel mode)

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
## Featured IVR example _(using YateChannel)_

IVR Description:

- Answer on the service number = 1234567890

    |

- **Welcome menu (entry point)**
1. Setup the DTMF handler:

    _1 = Jump to the Callerid menu_

    _2 = Jump to the Echotest menu_

    _3 = Transfer to support_

    _0 = Repeat Welcome menu prompt_

2. Play the menu prompt
3. Pause 5 seconds
4. Repeat the prompt up to 3 times or end the call

    |

- **Callerid Menu**
1. Setup the DTMF handler:

    _1 = Repeat Callerid_
    
    _0 = Return to the Welcome menu_

2. Play the caller id by numbers
3. Replay slower
4. Wait 10 seconds and redirect to Welcome

    |

- **Echotest Menu**
1. Setup the DTMF handler:

    _1 = Repeat Echotest_

    _0 = Return to the Welcome menu_

2. Play the Echo prompt
3. Give the signal to start recording
4. Record a sample lasting 3 seconds
5. Give the signal of the end of the recording
6. Play the recorded sample
7. Wait 10 seconds and redirect to Welcome

Code:

```javascript
const {Yate, YateChannel} = require("next-yate");
const yate = new Yate({host: "127.0.0.1"});
yate.init(); // Connect to Yate
yate.install(onRoute, "call.route", 100, "called", "1234567890"); // Install the service number 1234567890

function onRoute(message) {
    message.retValue("dumb/");
    message.autoanswer = true;
    let chan = new YateChannel(message);
    chan.caller = message.caller; // Remember the callerid
    chan.counter = 0; // Welcome prompt counter
    chan.init(() => welcome(chan)).catch(console.log));
    return true;
}

// Welcome menu item
async function welcome(chan) {
    if (!chan.ready) return;
    chan.counter++;

    // Setup DTMF handler
    chan.watch(dtmf => {
        switch(dtmf.text) {
            case "1":
                chan.reset(); // Drop the active chain of prompts
                callerid(chan); // Jump to CallerId menu item
                break;
            case "2":
                chan.reset();
                echo(chan); // Jump to Echo menu item
                break;
            case "3":
                chan.reset();
                chan.callJust("sip/sip:support@1.2.3.4"); // Transfer the call to support
                break;
            case "0":
                chan.reset();
                welcome(chan); // Jump to Welcome menu item
                break;
        }
    }, "chan.dtmf");

    // Play the chain of prompts
    try {
        await chan.callTo("wave/play/./share/sounds/words/hello.wav");
        await chan.callTo("wave/play/./share/sounds/words/you-have-reached-a-test-number.wav");
        await chan.callTo("wave/play/./share/sounds/words/press-1.wav");
        await chan.callTo("wave/play/./share/sounds/words/to-hear-callerid.wav");
        await chan.callTo("wave/play/./share/sounds/words/press-2.wav");
        await chan.callTo("wave/play/./share/sounds/words/to-echotest.wav");
        await chan.callTo("wave/play/./share/sounds/words/press-3.wav");
        await chan.callTo("wave/play/./share/sounds/words/to-talk-with-operator.wav");
        await chan.callTo("wave/play/./share/sounds/words/press-0.wav");
        await chan.callTo("wave/play/./share/sounds/words/to-hear-menu-again.wav");
        // Wait 5 sec and repeat the prompt
        await new Promise(res => {setTimeout(res, 5000)});
        // Repeat the prompt or hangup
        if (chan.counter < 2) {
            welcome(chan);
        } else {
            chan.hangup();
        }
    } catch(err) {
        console.log(err);
        return;
    }
}

// CallerId menu item
async function callerid(chan) {
    if (!chan.ready) return;

    // Change DTMF handler: 
    chan.watch(dtmf => {
        if (dtmf.text === "1") {
            chan.reset();
            callerid(chan);
        } else if (dtmf.text === "0") {
            chan.reset();
            welcome(chan);
        }
    }, "chan.dtmf");

    // Play the sequence
    try {
        // Say the callerid by numbers
        await chan.callTo("wave/play/./share/sounds/words/your-callerid-is.wav");
        for (let i = 0; i < chan.caller.length; i++) {
            await chan.callTo("wave/play/./share/sounds/digits/" + chan.caller.charAt(i) + ".wav");
        }
        await chan.callTo("wave/record/-", {timeout: 2000});
        // Repeat the callerid slowly
        await chan.callTo("wave/play/./share/sounds/words/your-callerid-is.wav");
        for (let i = 0; i < chan.caller.length; i++) {
            await chan.callTo("wave/play/./share/sounds/digits/" + chan.caller.charAt(i) + ".wav");
            await chan.callTo("wave/record/-", {timeout: 500}); // here is pause 0.5 sec between words
        }
        // Wait 2 seconds
        await chan.callTo("wave/record/-", {timeout: 2000});
        // Play menu prompt
        await chan.callTo("wave/play/./share/sounds/words/press-1.wav");
        await chan.callTo("wave/play/./share/sounds/words/to-hear-callerid.wav");
        await chan.callTo("wave/play/./share/sounds/words/again.wav");
        // Wait 10 seconds
        await chan.callTo("wave/record/-", {timeout: 10000});
        // If nothing happened back to Welcome
        welcome(chan);
    } catch(err) {
        console.log(err);
        return;
    }
}

// Echo menu item
async function echo(chan) {
    if (!chan.ready) return;

    chan.watch(dtmf => {
        if (dtmf.text === "1") {
            chan.reset();
            echo(chan);
        } else if (dtmf.text === "0") {
            chan.reset();
            welcome(chan);
        }
    }, "chan.dtmf");

    // Rec and play the Echo
    try {
        let rec = "/tmp/rec-" + Date.now() + ".au";
        // Play prompt
        await chan.callTo("wave/play/./share/sounds/echotest.au");
        // tink
        await chan.callTo("tone/dtmf/0");
        // Rec the voice 3 seconds
        await chan.callTo("wave/record/" + rec, {timeout: 3000});
        // tink
        await chan.callTo("tone/dtmf/0");
        // Play recorded voice
        await chan.callTo("wave/play/" + rec);
        // tink
        await chan.callTo("tone/dtmf/0");
        // Wait 10 sec
        await chan.callTo("wave/record/-", {timeout: 10000});
        // Go to welcome
        welcome(chan);
    } catch(err) {
        console.log(err);
        return;
    }
}

```

### More examples
[examples](https://github.com/0LEG0/next-yate/tree/master/examples)

### API
[View API](API.md)


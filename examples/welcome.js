/**
 * Network-In-a-Box demo
 * @file welcome.js
 * @author Yate Team
 * @description Simple IVR adapted to Nodejs by Anton <aucyxob@gmail.com>
 * @see http://docs.yate.ro/wiki/Javascript_IVR_example
 * @example 
 * regexroute.conf:
 * ^32843=extmodule/nodata/node.sh welcome.js
 */

const {Engine, Message, Channel} = require("next-yate").getEngine({channel: true}); // special option 'channel' to create the Channel object
Channel.init(main, {autoanswer: true}); // Init with callback function 'main' and option 'autoanswer'

var state = "";
var prompts_dir = "./share/sounds/";

Engine.debugName("welcome");
Engine.debugLevel(Engine.DebugInfo);

function onChanDtmf(msg)
{
    if (msg.text == 1) {
        state = "echoTest";
        Channel.callTo("wave/play/" + prompts_dir + "echo.au");
    } else if (msg.text == 2) {
        Channel.callJust("conf/333", {"lonely": true});
    } else if (msg.text == 3) {
        Channel.callJust("iax/iax:090@192.168.1.1/090", {"caller": "yatebts"});
    }
}

async function welcomeIVR(msg)
{
    Engine.debug(Engine.DebugInfo, "Got call to welcome IVR.");

    Message.install(onChanDtmf, "chan.dtmf", 90, "id", msg.id);
    await Channel.callTo("wave/play/" + prompts_dir + "welcome.au");

    if (state == "")
        // No digit was pressed
        // Wait aprox 10 seconds to see if digit is pressed
        await Channel.callTo("wave/record/-", {"maxlen": 180000});
    
    Engine.debug(Engine.DebugInfo, "Returned to main function in state '" + state + "'");

    if (state == "echoTest")
        Channel.callJust("external/playrec/echo.sh");
}

function main(message) {
    //if (message.called=="32843")
        welcomeIVR(message);
}

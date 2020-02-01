/**
 * @file check_route.js
 * @license Apache-2.0
 * @author Anton <aucyxob@gmail.com>
 * @description The test routing rmanager utility is based on core API of "next-yate"
 * @example 
 * >telnet localhost 5038
 * >route 99991001
 */

const { Yate, Message } = require("next-yate");

let yate = new Yate({host: "127.0.0.1", debug: true});
yate.init();

async function onCommand(msg) {
    // autocomplete line
    if ("route".startsWith(msg.partial)) {
        msg.retValue(
            msg.retValue() +
            (msg.retValue() ? "\troute" : "route")
        );
        return;
    }

    // parse command line
    let [command, called] = msg.line.split(" ");
    if (command !== "route") return;

    // find route
    let call_route = new Message("call.route", {called: called});
    let start_at = Date.now();
    let route_result = await yate.dispatch(call_route);
    let duration = Date.now() - start_at;

    // formatted answer
    msg.retValue(
        "Result: " + (route_result.retValue() === "" ? "None" : route_result.retValue()) +
        "\r\nhandlers: " + route_result.handlers +
        "\r\nduration: " + duration + "ms\r\n\r\n"
    );

    return true;
}

yate.install(onCommand, "engine.command");
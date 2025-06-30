
// Dependencies for callable functions.
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {logger} = require("firebase-functions/v2");

exports.list_local_stdio_server_tools = onCall((request) => {
   logger.info("Horatio, i am killed, thou livest- report me and my cause aright.", {request});
    return {
        foo: "baz"
    };
    // [END v2returnAddData]
});
// [END v2allAdd]


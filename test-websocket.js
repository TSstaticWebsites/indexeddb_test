const WebSocket = require("ws");
const ws = new WebSocket("wss://164.92.163.217");
ws.on("open", () => {
  console.log("Connected successfully to signaling server");
  process.exit(0);
});
ws.on("error", (error) => {
  console.error("Failed to connect:", error);
  process.exit(1);
});
setTimeout(() => {
  console.error("Connection timeout after 5 seconds");
  process.exit(1);
}, 5000);

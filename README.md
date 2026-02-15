# Backstage Timer 

Simple Node.js backstage timer that listens to Multiplay OSC and broadcasts NOW / NEXT to a web client via Socket.IO.

Usage

1. Install dependencies:

```bash
npm install
```

2. Run the server:

```bash
node server.js
```

Defaults:
- HTTP: port 3000
- MultiPlay outgoing OSC: 9000
- MultiPlay Incoming OSC: 8000



Open: http://localhost:3000

Logs:
- Server logs `[OSC RECEIVED]` and `[BROADCAST]` lines for debugging.

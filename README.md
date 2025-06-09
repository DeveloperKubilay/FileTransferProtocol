# FileTransferProtocol 📂✨

Yo, this is a super lit file transfer tool that lets you send files between computers on the same network! No cap, it's mad simple to use. 💯

## What's This? 🤔

This tool lets you move files between devices without all that extra nonsense. Just straight-up file transfers over your local network - that's it!

## Features 🔥

- ⚡ Fast file transfers over TCP
- 📊 Real-time transfer speed monitoring
- ✅ File integrity verification with MD5 hashing
- 📁 Preserves folder structure
- 🔄 Auto-creates directories as needed
- 💻 Works in CLI so it's lightweight AF

## How to Use 👨‍💻

### Server Mode 📤

```bash
lftp foldername

or

lftp
```

### Client Mode 📥

```bash
lftp 1.106 newfolder

or

lftp
```

## Tech Info 🧠

- Built with Node.js (no extra dependencies)
- Uses TCP sockets for reliable transfers
- Implements chunk-based transfer with acknowledgments
- Verifies file integrity using MD5 checksums

## Requirements 📋

- Node.js installed
- Computers need to be on the same network
- That's literally it

## Why This Slaps 💪

No need for cloud storage, complicated setups, or sharing links. Just straight-up file transfers between your devices - simple as that!

---

## Made with ❤️ by DeveloperKubilay
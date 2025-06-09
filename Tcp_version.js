var isServer = false;
const readline = require("readline");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const net = require("net");
const interfaces = require("os").networkInterfaces();
const fs = require("fs");
const path = require("path");
const crypto = require('crypto');
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}
rl.on('SIGINT', () => process.exit());
async function main() {
  if(!process.argv[2])  {
    const Server = await askQuestion("ITS SERVER ? (y/n): ");
    if (Server === "y" || Server === "Y" || Server === "yes" || Server === "YES")
      isServer = true;
  }else{
    if(process.argv[2] === "server") isServer = true;
    if(process.argv[2] === "client") isServer = false;
  }
  if (isServer) {
    const folderpath = process.argv[3] ? process.argv[3] : await askQuestion("Enter the folder path: ");
    
    // Check if folder exists
    if (!fs.existsSync(folderpath)) {
      console.error(`Error: Folder '${folderpath}' does not exist`);
      process.exit(1);
    }
    
    function getAllFiles(dirPath, baseDir = '') {
        const files = fs.readdirSync(dirPath); 
        const Directorys = new Set();
        const Files = new Set(); 
        
        files.forEach((file) => {
            const fullPath = path.join(dirPath, file);
            const relativePath = path.join(baseDir, file);
    
            if (fs.statSync(fullPath).isDirectory()) {
                Directorys.add(relativePath); 
                const subFiles = getAllFiles(fullPath, relativePath); 
                subFiles.directories.forEach(d => Directorys.add(d)); 
                subFiles.files.forEach(f => Files.add(f));
            } else {
                Files.add(relativePath); 
            }
        });
        return {
            directories: Array.from(Directorys),
            files: Array.from(Files)
        };
    }

    const temp = getAllFiles(folderpath);
    const Files = temp.files;
    const Directorys = temp.directories;
    
    console.log(`Found ${Directorys.length} directories and ${Files.length} files`);

    const server = net.createServer((socket) => {
      console.log("Client connected");
      
      // Better directory format with JSON
      socket.write(JSON.stringify({ directories: Directorys }));
      
      var speed = 0;
      var currentFile = null;
      const speedInterval = setInterval(() => {
          console.log("Speed:",(speed/1024/1024).toFixed(2)+"MB/s",currentFile);
          speed = 0;
      }, 1000);
      
      socket.on("close", () => {
        clearInterval(speedInterval);
      });

      // Improved chunk-based transfer system
      let pendingAck = false;
      let chunkQueue = [];
      let currentChunkId = 0;
      let fileReadStream = null;
      let bytesTransferred = 0;
      let fileSize = 0;
      let fileHash = null;
      
      // Function to send the next chunk (if any)
      function sendNextChunk() {
        if (pendingAck || chunkQueue.length === 0) return;
        
        const nextChunk = chunkQueue.shift();
        currentChunkId = nextChunk.id;
        pendingAck = true;
        
        // Format: [0x01][chunk-id(4 bytes)][data]
        const header = Buffer.alloc(5);
        header[0] = 0x01;
        header.writeUInt32LE(nextChunk.id, 1);
        
        const result = socket.write(Buffer.concat([header, nextChunk.data]));
        if (!result && fileReadStream) {
          fileReadStream.pause();
        }
      }

      socket.on("data", (data) => {
        const message = data.toString().trim();
        
        // Handle chunk acknowledgment
        if (message.startsWith("ACK:")) {
          const ackId = parseInt(message.split(":")[1]);
          if (ackId === currentChunkId) {
            pendingAck = false;
            if (fileReadStream && fileReadStream.isPaused()) {
              fileReadStream.resume();
            }
            sendNextChunk();
          }
          return;
        }
        
        console.log("Received from client:", message);
        
        if(message === "iamokey") {
          if(Files.length === 0) {
            console.log("No more files to send");
            socket.write(Buffer.from([0x03]));
            return;
          }
          
          const file = Files.shift();
          if(file && fs.existsSync(path.join(folderpath, file))) {
            console.log("Sending file:", file);
            const filePath = path.join(folderpath, file);
            // Send file with metadata (name and size)
            const stats = fs.statSync(filePath);
            socket.write(`FILE:${file}:${stats.size}`);
          } else {
            console.log("File not found:", file);
            socket.write("iamokey"); // Ask for next file
          }
        } else if(message.startsWith("READY:")) {
          // Client is ready to receive the requested file
          const requestedFile = message.replace("READY:", "");
          console.log("Client ready for file:", requestedFile);
          
          // Reset transfer state
          currentFile = requestedFile;
          chunkQueue = [];
          currentChunkId = 0;
          pendingAck = false;
          bytesTransferred = 0;
          
          const filePath = path.join(folderpath, requestedFile);
          
          if(!fs.existsSync(filePath)) {
            console.log("File not found:", filePath);
            socket.write(Buffer.from([0x03]));
            return;
          }
          
          fileSize = fs.statSync(filePath).size;
          fileHash = crypto.createHash('md5');
          
          // Create a smaller chunk size for better reliability
          fileReadStream = fs.createReadStream(filePath, { 
            highWaterMark: 16 * 1024 // 16KB chunks for better reliability
          });
          
          let chunkId = 0;
          
          fileReadStream.on("data", (chunk) => {
              fileHash.update(chunk);
              bytesTransferred += chunk.length;
              speed += chunk.length;
              
              // Add chunk to queue
              chunkQueue.push({
                id: chunkId++,
                data: chunk
              });
              
              // If no pending ACK, send the next chunk
              if (!pendingAck) {
                sendNextChunk();
              }
          });
          
          socket.on("drain", () => {
            // Socket buffer drained, resume if needed
            if (fileReadStream && fileReadStream.isPaused()) {
              fileReadStream.resume();
            }
          });
          
          fileReadStream.on("end", () => {
              console.log("Reading file complete:", requestedFile, 
                          `(${bytesTransferred}/${fileSize} bytes)`);
              
              // Wait for all chunks to be sent before sending EOF
              const checkComplete = setInterval(() => {
                if (chunkQueue.length === 0 && !pendingAck) {
                  clearInterval(checkComplete);
                  
                  // Send EOF message with file hash and size for verification
                  const md5Hash = fileHash.digest('hex');
                  socket.write(Buffer.concat([
                    Buffer.from([0x02]),
                    Buffer.from(`${md5Hash}:${bytesTransferred}:${fileSize}`)
                  ]));
                  
                  // Clean up
                  fileReadStream = null;
                  fileHash = null;
                }
              }, 100);
          });
          
          fileReadStream.on("error", (err) => {
              console.error("Error reading file:", err);
              socket.write(Buffer.from([0x03]));
              fileReadStream = null;
          });
        }
      });

      socket.on("end", () => {
        clearInterval(speedInterval);
        console.log("Client disconnected");
      });
      
      socket.on("error", (err) => {
        clearInterval(speedInterval);
        if (err.code === "ECONNRESET") {
          console.log("Client disconnected");
        } else  console.error("Socket error: ", err);
      });
    });

    server.on("error", (err) => {
      console.error("Server error: ", err);
      process.exit();
    });
    
    const PORT = 18080;
    server.listen(PORT, () => {
      let found = false;
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (
            iface.family === "IPv4" &&
            !iface.internal &&
            iface.address.startsWith("192.168.")
          ) {
            console.log(`Server listening on ${iface.address}:${PORT}`);
            found = true;
          }
        }
      }
      if (!found) {
        console.log(`Server listening on localhost:${PORT}`);
      }
    });
    
  } else {
    const Serverip = await askQuestion("Enter the Server ip: 192.168.");
    const Folderpath = process.argv[3] ? process.argv[3] : await askQuestion("Enter the folder path: "); 
    
    // Create destination folder if it doesn't exist
    if (!fs.existsSync(Folderpath)) {
      fs.mkdirSync(Folderpath, { recursive: true });
      console.log(`Created destination folder: ${Folderpath}`);
    }
    
    const client = new net.Socket();
    const PORT = 18080;
    client.connect(PORT, "192.168."+Serverip, () => {
      console.log(`Connected to server at 192.168.${Serverip}:${PORT}`);
    });
    
    client.once('data', (data) => {
      try {
        // Parse directory structure from JSON
        const dirInfo = JSON.parse(data.toString());
        console.log(`Received ${dirInfo.directories.length} directories`);
        
        dirInfo.directories.forEach((element) => {
          if (element && element.trim() !== '') {
            const dirPath = path.join(Folderpath, element);
            console.log(`Creating directory: ${dirPath}`);
            fs.mkdirSync(dirPath, { recursive: true });
          }
        });
        
        var fileStream = null;
        var speed = 0;
        var currentFile = null;
        var expectedFileSize = 0;
        var receivedBytes = 0;
        var fileHash = null;
        var lastChunkId = -1;
        
        const speedInterval = setInterval(() => {
            const percentage = expectedFileSize > 0 ? ((receivedBytes / expectedFileSize) * 100).toFixed(2) : 0;
            console.log(`Speed: ${(speed/1024/1024).toFixed(2)}MB/s ${currentFile} ` + 
                       `${receivedBytes}/${expectedFileSize} bytes (${percentage}%)`);
            speed = 0;
        }, 1000);
        
        client.on("close", () => {
          clearInterval(speedInterval);
          if (fileStream) fileStream.end();
        });
        
        console.log("Requesting first file...");
        client.write("iamokey");
        
        client.on("data", (data) => {
          // Handle control bytes
          if (data[0] === 0x01) { // File data chunk
            if (!fileStream) {
              console.error("Received file data without an open file");
              return;
            }
            
            // Extract chunk ID from header (4 bytes after control byte)
            const chunkId = data.readUInt32LE(1);
            const chunk = data.slice(5); // Skip control byte and chunk ID
            
            // Only process if this is the next expected chunk or we haven't received any chunks yet
            if (chunkId === lastChunkId + 1) {
              if (fileHash) {
                fileHash.update(chunk);
              }
              
              receivedBytes += chunk.length;
              speed += chunk.length;
              lastChunkId = chunkId;
              
              fileStream.write(chunk, (err) => {
                if (err) {
                  console.error("Error writing to file:", err);
                }
              });
            } else {
              console.warn(`Received out-of-order chunk. Expected: ${lastChunkId + 1}, Got: ${chunkId}`);
            }
            
            // Send acknowledgment for the chunk we received
            client.write(`ACK:${chunkId}`);
            return;
          }
          
          if (data[0] === 0x02) { // File complete
            const endInfo = data.slice(1).toString();
            const [hashValue, sentSize, originalSize] = endInfo.split(':');
            
            console.log(`File transfer complete: ${currentFile}`);
            console.log(`Received: ${receivedBytes} bytes, Expected: ${expectedFileSize} bytes`);
            
            if (fileStream) {
              // Ensure all data is written before closing
              fileStream.end(() => {
                const actualSize = fs.statSync(path.join(Folderpath, currentFile)).size;
                const calculatedHash = fileHash ? fileHash.digest('hex') : '';
                
                if (receivedBytes !== parseInt(sentSize) || 
                    receivedBytes !== actualSize || 
                    receivedBytes !== parseInt(originalSize)) {
                  console.error(`⚠️ FILE SIZE MISMATCH! Original: ${originalSize}, Sent: ${sentSize}, Received: ${receivedBytes}, Actual: ${actualSize}`);
                } else if (calculatedHash !== hashValue) {
                  console.error(`⚠️ FILE HASH MISMATCH! Expected: ${hashValue}, Actual: ${calculatedHash}`);
                } else {
                  console.log(`✓ File integrity verified (${actualSize} bytes)`);
                }
                
                fileStream = null;
                currentFile = null;
                receivedBytes = 0;
                expectedFileSize = 0;
                fileHash = null;
                lastChunkId = -1;
                client.write("iamokey");
              });
            }
            return;
          }
          
          if (data[0] === 0x03) { // No more files
            console.log("No more files to transfer");
            if (fileStream) {
              fileStream.end();
              fileStream = null;
            }
            client.end();
            return;
          }
          
          // Handle file name message
          const message = data.toString().trim();
          if (message.startsWith("FILE:")) {
            const [, filename, filesize] = message.split(":");
            currentFile = filename;
            expectedFileSize = parseInt(filesize);
            receivedBytes = 0;
            fileHash = crypto.createHash('md5');
            lastChunkId = -1;
            
            console.log(`Preparing to receive file: ${currentFile} (${expectedFileSize} bytes)`);
            
            // Create directory for the file if needed
            const fileDir = path.dirname(path.join(Folderpath, currentFile));
            if (!fs.existsSync(fileDir)) {
              fs.mkdirSync(fileDir, { recursive: true });
            }
            
            // Create write stream with proper options
            fileStream = fs.createWriteStream(path.join(Folderpath, currentFile), {
              flags: 'w',
              encoding: null, // binary
              highWaterMark: 16 * 1024 // 16KB buffer to match server chunks
            });
            
            fileStream.on("error", (err) => {
              console.error("Error writing file:", err);
              client.end();
            });
            
            // Acknowledge that we're ready to receive the file
            client.write("READY:" + currentFile);
          }
        });
      } catch (error) {
        console.error("Error processing server data:", error);
        client.end();
      }
    });

    client.on('close', () => {
        console.log('Connection closed');
    });

    client.on('error', (err) => {
        console.error('Connection error:', err);
    });
  }
}
main();

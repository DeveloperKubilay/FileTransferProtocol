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

    const server = net.createServer((socket) => {
      console.log("Client connected");
      socket.write(Directorys.join('"'));
      var speed = 0;
      var currentFile = null;
      setInterval(() => {
          console.log("Speed:",(speed/1024/1024).toFixed(2)+"MB/s",currentFile);
          speed = 0;
      }, 1000);

      socket.on("data", (data) => {
        if(data =="iamokey") {
          if(Files.length == 0) socket.write(Buffer.from([0x03]));
          const file = Files.shift();
          if(file && fs.existsSync(path.join(folderpath, file))) {
            socket.write(file);
            const fileStream = fs.createReadStream(path.join(folderpath, file));
            currentFile = file;
            fileStream.on("data", (chunk) => {
                speed += chunk.length;
                socket.write(Buffer.concat([Buffer.from([0x01]), chunk]));
            })
            fileStream.on("end", () => {
                socket.write(Buffer.from([0x02]));
            })
          }
          return;
        }
        
      });

      socket.on("end", () => {
        console.log("Client disconnected");
        process.exit();
      });
      socket.on("error", (err) => {
        if (err.code === "ECONNRESET") {
          console.log("Client disconnected");
        } else  console.error("Socket error: ", err);
        process.exit();
      });
    });

    server.on("error", (err) => {
      console.error("Server error: ", err);
      process.exit();
    });
    server.listen(18080, () => {
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (
            iface.family === "IPv4" &&
            !iface.internal &&
            iface.address.startsWith("192.168.")
          ) {
            console.log(`Server listening on ${iface.address}:8080`);
          }
        }
      }
    });
  } else {
    const Serverip = await askQuestion("Enter the Server ip: 192.168.");
    const Folderpath = process.argv[3] ? process.argv[3] : await askQuestion("Enter the folder path: "); 
    const client = new net.Socket();
    client.connect(18080, "192.168."+Serverip, () => {
      console.log("Connected to server");
    });
    

client.once('data', (data) => {
    data.toString().split("\"").forEach((element) => {
        fs.mkdirSync(path.join(Folderpath, element), { recursive: true });
    });
    var fileStream = null;
    var speed = 0;
    var currentFile = null;
    setInterval(() => {
        console.log("Speed:",(speed/1024/1024).toFixed(2)+"MB/s",currentFile);
        speed = 0;
    }, 1000);
    client.write("iamokey");
    client.on("data", (data) => {
        if(!fileStream) {
            if(data[0] == 0x03) {
                client.end();
                return process.exit();
            }
            currentFile = data.toString();
            return fileStream = fs.createWriteStream(path.join(Folderpath, currentFile));
        }else{
            if(data[0] == 0x01) {
                speed += data.length;
                return fileStream.write(data.slice(1));
            }
            else if(data[0] == 0x02) {
                fileStream.end();
                fileStream = null;
                client.write("iamokey");
                return;
            }
        }
        
    })
});

client.on('close', () => {
    console.log('Connection closed');
    process.exit();
});

client.on('error', (err) => {
    console.error('Connection error:', err);
    process.exit();
});

  }
}
main();

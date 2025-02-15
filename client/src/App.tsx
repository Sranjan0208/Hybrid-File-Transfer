import React, { useState, useRef, useEffect } from "react";
import { io } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useDropzone } from "react-dropzone";

const socket = io("http://localhost:5000"); // Connect to signaling server

const FileTransferApp: React.FC = () => {
  const [connected, setConnected] = useState(false);
  const [peerId, setPeerId] = useState("");
  const [remotePeerId, setRemotePeerId] = useState("");
  const [status, setStatus] = useState("Not Connected");
  const [fileQueue, setFileQueue] = useState<File[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<
    { name: string; blob: Blob }[]
  >([]);
  const [progress, setProgress] = useState(0);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);

  useEffect(() => {
    socket.on("connect", () => {
      setConnected(true);
      if (socket.id) {
        setPeerId(socket.id);
      }
    });

    socket.on("offer", async ({ sdp, sender }) => {
      setStatus("Received offer, creating answer...");
      peerConnection.current = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "turn:my.turn.server", username: "user", credential: "pass" },
        ],
      });

      // Handle incoming ICE candidates
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", { candidate: event.candidate });
        }
      };

      peerConnection.current.ondatachannel = (event) => {
        dataChannel.current = event.channel;
        setupDataChannel();
      };
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      socket.emit("answer", { sdp: answer, receiver: sender });
    });

    socket.on("answer", async ({ sdp }) => {
      setStatus("Answer received, finalizing connection...");
      await peerConnection.current?.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );
    });

    socket.on("ice-candidate", ({ candidate }) => {
      peerConnection.current?.addIceCandidate(new RTCIceCandidate(candidate));
    });
  }, []);

  const createOffer = async () => {
    setStatus("Creating offer...");
    peerConnection.current = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "turn:my.turn.server", username: "user", credential: "pass" },
      ],
    });
    dataChannel.current =
      peerConnection.current.createDataChannel("fileChannel");
    setupDataChannel();

    // Handle Ice candidates
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate && remotePeerId) {
        socket.emit("ice-candidate", {
          candidate: event.candidate,
          receiver: remotePeerId,
        });
      }
    };

    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);
    socket.emit("offer", {
      sdp: offer,
      sender: peerId,
      receiver: remotePeerId,
    });
  };

  const setupDataChannel = () => {
    if (!dataChannel.current) return;

    let receivedChunks: Blob[] = [];

    dataChannel.current.onopen = () => {
      setStatus("Connected! Ready to transfer files.");
    };

    dataChannel.current.onmessage = (event) => {
      if (event.data === "EOF") {
        const receivedBlob = new Blob(receivedChunks);
        setReceivedFiles((prev) => [
          ...prev,
          { name: `received_file_${Date.now()}`, blob: receivedBlob },
        ]);
        receivedChunks = [];
      } else if (event.data instanceof Blob) {
        receivedChunks.push(event.data);
      }
    };
  };

  const onDrop = (acceptedFiles: File[]) => {
    setFileQueue([...fileQueue, ...acceptedFiles]);
  };

  const sendFiles = () => {
    if (!dataChannel.current) return;

    fileQueue.forEach((file) => {
      const chunkSize = 16 * 1024; // 16 KB per chunk
      let offset = 0;

      const sendChunk = () => {
        if (offset < file.size) {
          const slice = file.slice(offset, offset + chunkSize);
          dataChannel.current?.send(slice);
          offset += chunkSize;
          setProgress((offset / file.size) * 100);

          setTimeout(sendChunk, 50); // Prevent blocking the channel
        } else {
          dataChannel.current?.send("EOF"); // End of file marker
        }
      };
      sendChunk();
    });
  };

  const { getRootProps, getInputProps } = useDropzone({ onDrop });

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <Card className="w-full max-w-md p-6">
        <CardContent>
          <h1 className="text-2xl font-bold mb-4">WebRTC File Transfer</h1>
          <p className="mb-2">Peer ID: {peerId}</p>
          <p className="mb-4">Status: {status}</p>

          <Input
            type="text"
            placeholder="Enter Remote Peer ID"
            value={remotePeerId}
            onChange={(e) => setRemotePeerId(e.target.value)}
            className="mb-4"
          />

          <Button onClick={createOffer} className="mb-4 w-full">
            Create Connection
          </Button>

          <div
            {...getRootProps()}
            className="border p-4 rounded-lg cursor-pointer mb-4"
          >
            <input {...getInputProps()} />
            <p>Drag & Drop files here or click to select</p>
          </div>

          <Button onClick={sendFiles} className="mb-4 w-full">
            Send Files
          </Button>

          <Progress value={progress} className="w-full" />

          {receivedFiles.length > 0 && (
            <div className="mt-4">
              <h2 className="text-lg font-bold">Received Files:</h2>
              <ul>
                {receivedFiles.map((file, index) => (
                  <li
                    key={index}
                    className="flex items-center justify-between mt-2"
                  >
                    {file.blob.type.startsWith("image/") ? (
                      <img
                        src={URL.createObjectURL(file.blob)}
                        alt="Preview"
                        className="w-16 h-16 object-cover rounded-md"
                      />
                    ) : (
                      <span>{file.name}</span>
                    )}
                    <Button
                      onClick={() => {
                        const url = URL.createObjectURL(file.blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = file.name;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                      className="ml-2"
                    >
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FileTransferApp;

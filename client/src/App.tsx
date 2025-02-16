import React, { useState, useRef, useEffect } from "react";
import { io } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useDropzone } from "react-dropzone";

const socket = io("http://localhost:5000"); // Connect to signaling server

const CHUNK_SIZE = 64 * 1024; // Start with 64KB

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
  const [transferSpeed, setTransferSpeed] = useState(0);

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
        if (peerConnection.current?.iceConnectionState === "disconnected") {
          setStatus("Disconnected. Reconnect required.");
        }
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
      } else if (event.data instanceof ArrayBuffer) {
        receivedChunks.push(new Blob([event.data])); // Directly convert to Blob
      }
    };

    dataChannel.current.onerror = (error) => {
      console.error("Data channel error:", error);
      setStatus("Error: Connection lost.");
    };
  };

  const onDrop = (acceptedFiles: File[]) => {
    setFileQueue([...fileQueue, ...acceptedFiles]);
  };

  const sendFiles = () => {
    if (!dataChannel.current) return;

    fileQueue.forEach((file) => {
      let offset = 0;

      const sendChunk = () => {
        if (!dataChannel.current || offset >= file.size) {
          dataChannel.current?.send("EOF"); // End-of-file marker
          return;
        }

        const startTime = Date.now();
        let bytesSent = 0;

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();

        reader.onload = async (event) => {
          const buffer = event.target?.result as ArrayBuffer;

          if (dataChannel.current?.bufferedAmount) {
            // Handle backpressure
            while (dataChannel.current?.bufferedAmount > 65536) {
              // Wait if buffer is full
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          }
          dataChannel.current?.send(buffer);
          offset += CHUNK_SIZE;
          setProgress((offset / file.size) * 100);

          setTimeout(sendChunk, 0); // Continue sending
        };

        reader.readAsArrayBuffer(slice);

        bytesSent += CHUNK_SIZE;
        setTransferSpeed(calculateSpeed(bytesSent, startTime));
      };
      sendChunk();
    });
  };

  const calculateSpeed = (bytesSent: number, startTime: number): number => {
    const duration = (Date.now() - startTime) / 1000; // Convert to seconds
    if (duration === 0) return 0; // Prevent division by zero
    return parseFloat((bytesSent / duration / 1024).toFixed(2)); // Convert bytes to KB/s
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

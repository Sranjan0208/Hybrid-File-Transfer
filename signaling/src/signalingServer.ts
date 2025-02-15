import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const peers: Record<string, string> = {}; // Store connected peers

io.on("connection", (socket: Socket) => {
  console.log(`Client connected: ${socket.id}`);
  peers[socket.id] = socket.id;

  // Notify all peers of the updated peer list
  io.emit("peers-update", Object.keys(peers));

  // Handle offer
  socket.on("offer", ({ sdp, sender, receiver }) => {
    if (!receiver) {
      console.error(`Offer from ${sender} has no receiver!`);
      return;
    }
    console.log(`Offer from ${sender} to ${receiver}`);
    io.to(receiver).emit("offer", { sdp, sender });
  });

  // Handle answer
  socket.on("answer", ({ sdp, receiver }) => {
    console.log(`Answer from ${socket.id} to ${receiver}`);
    io.to(receiver).emit("answer", { sdp, sender: socket.id });
  });

  // Handle ICE candidates
  socket.on("ice-candidate", ({ candidate, receiver }) => {
    if (!receiver) {
      console.error(`ICE Candidate from ${socket.id} has no receiver!`);
      return;
    }
    console.log(`ICE Candidate from ${socket.id} to ${receiver}`);
    io.to(receiver).emit("ice-candidate", { candidate, sender: socket.id });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    delete peers[socket.id];
    io.emit("peers-update", Object.keys(peers)); // Update all clients
  });
});

// Health check route
app.get("/health", (_req, res) => {
  res.status(200).send("Signaling server is running.");
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});

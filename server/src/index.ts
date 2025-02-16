import express, { Request, Response } from "express";
import multer from "multer";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import fs from "fs-extra";
import dotenv from "dotenv";
import { File } from "./models/fileSchema";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use(cors());

// Multer Storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadPath = "./uploads";
    fs.ensureDirSync(uploadPath);
    cb(null, uploadPath);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

app.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const newFile = new File({
      filename: req.file.filename,
      originalname: req.file.originalname,
      fileUrl: `http://localhost:${PORT}/download/${req.file.filename}`,
    });
    await newFile.save();
    res.json({ fileUrl: newFile.fileUrl });
  }
);

// Download file
app.get("/download/:filename", async (req: Request, res: Response) => {
  const filePath = `./uploads/${req.params.filename}`;
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// Auto delete expired files every hour
setInterval(async () => {
  const expiredFiles = await File.find({ expiresAt: { $lt: new Date() } });
  for (const file of expiredFiles) {
    await fs.remove(`./uploads/${file.filename}`);
    await File.deleteOne({ _id: file._id });
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});

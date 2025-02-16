import mongoose from "mongoose";

interface IFile extends mongoose.Document {
  filename: string;
  originalName: string;
  fileUrl: string;
  expiresAt: Date;
}

const fileSchema = new mongoose.Schema<IFile>({
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
  }, // Auto delete in 24 hours
});

export const File = mongoose.model<IFile>("File", fileSchema);

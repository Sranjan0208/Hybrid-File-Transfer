import express, { Request, Response } from "express";

const app = express();

app.use(express.json());

app.get("/", (req: Request, res: Response) => {
  res.send("Hello");
});

app.listen("8000", () => {
  console.log("Server is running on PORT: 8000");
});

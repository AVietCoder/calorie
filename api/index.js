const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");
const crypto = require("crypto");

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from Express on Vercel 🚀" });
});


module.exports = app;
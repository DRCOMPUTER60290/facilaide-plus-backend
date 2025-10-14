import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import router from "./router.js";

dotenv.config();
const app = express();

const keyStatus = process.env.OPENAI_API_KEY 
  ? `✅ Clé OpenAI détectée (longueur: ${process.env.OPENAI_API_KEY.length})`
  : "❌ Aucune clé OpenAI détectée !";

console.log(keyStatus);



app.use(cors());
app.use(express.json());

// Routes API
app.use("/api", router);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});


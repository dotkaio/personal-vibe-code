import express from "express";
import chatRoutes from "./routes/chat";
import containerRoutes from "./routes/containers";

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use("/containers", containerRoutes);
app.use("/chat", chatRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Podman Container API running on port ${PORT}`);
});

export default app;

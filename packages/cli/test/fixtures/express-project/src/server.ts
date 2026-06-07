import express from "express";
import { paymentsRouter } from "./routes/payments.js";

const app = express();

app.use("/payments", paymentsRouter);
app.listen(3000);
